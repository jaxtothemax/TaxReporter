---
name: batch
model: opus
disable-model-invocation: true
description: >
  Pick up a batch of milestone issues and land them in parallel — one git
  worktree and one delegated agent per issue, each finishing with its own PR.
  Asks which milestone and which labels to pull from; never infers either.
  Enforces measured token-discipline rules (Sonnet by default, a hard wave cap,
  and per-agent commit verification). User-invoked only — it spawns many agents
  and spends real money, so it must never start on a model's own initiative.
argument-hint: "[milestone] [label ...]"
---

# Batch

In this repository an MR is a GitHub pull request (PR).

Land several milestone issues in one wave. Each issue gets its own worktree, its own
delegated agent, and its own PR. You are the orchestrator: you choose the issues, brief
the agents, verify what they actually produced, and report. You do **not** implement the
issues yourself.

## Why this skill is shaped the way it is

Upstream, batch work ran from a freehand prompt. It worked, and it cost **~122M tokens
per merged MR** (20 merged MRs for ~2,445M tokens across two waves). The composition of
the subagent spend is the whole design rationale:

| Component | Share |
|---|---|
| cache reads | **95.9%** |
| cache creation | 3.9% |
| output | 0.2% |

**Generation is not the cost. Re-reading context is.** The bill is
`turn count × context size × fan-out`, so every rule below attacks one of those three
factors. Spend was also concentrated rather than uniform — the top 10 of 169 subagents
were 44% of the total, one at 166M against a 6M median — so a single agent that wanders
costs more than twenty that stay focused. Capping the wave matters less than keeping each
agent short.

These are not style preferences. They are the difference between a wave that costs
billions of tokens and one that costs a few hundred million.

## Step 1 — Ask. Never infer.

Ask both questions with `AskUserQuestion` in a **single call** (two questions, one round
trip). Do not guess either answer, and do not skip the ask because the answer looks
obvious.

1. **Which milestone?** Offer the open milestones, nearest due date first:
   `gh api 'repos/{owner}/{repo}/milestones?state=open&sort=due_on&direction=asc' --jq '.[] | "\(.title)\t\(.due_on // "no due date")"'`
   (`gh api` fills `{owner}/{repo}` from the `origin` remote).
2. **Which labels to pull from?** Multi-select. Offer the commitment labels
   (`release:committed`, `release:reserve`, `release:stretch`) and the domain labels
   actually present on that milestone's open issues — read them, do not offer a
   hardcoded list.

Also ask **wave size** if the user has not said one, defaulting to **5**.

If the invocation names milestone and labels (`/batch 1.2 release:committed`), take them
and skip the ask.

## Step 2 — Select the issues

```bash
gh issue list --milestone "<M>" --label "<L>" --state open --limit 100 \
  --json number,title,labels
```

`--limit 100` is a cap, not a result set. A milestone with more issues than that
truncates silently here, and the issues you never see are indistinguishable from
issues that do not exist. When the count comes back at exactly the limit, re-read it
with a larger `--limit` (gh pages through the API itself). Repeating `--label` means
*all* of those labels, not any of them, so run one query per label when the user picked
several.

Then filter, in this order:

1. **Drop anything already claimed** — an issue carrying the check-out label
   (`status:wip` by default, `WT_LOCK_LABEL`), an issue number that already has an open
   PR (`gh pr list --state open --json number,headRefName,closingIssuesReferences`), or
   a worktree in `scripts/wt list`. `wt new` refuses a checked-out issue, and
   `scripts/check-issue-collision.sh` blocks a duplicate PR at push time, but check first
   so you are not selecting work you cannot start. The `--json labels` output above
   shows the label; to exclude claimed issues up front, query with
   `--search 'milestone:"<M>" label:"<L>" -label:"status:wip"'` instead of the
   `--milestone`/`--label` flags. Read the check-out
   comment (`🔒 checked out …`) before assuming a label is stale: it names the branch and
   worktree holding the issue. A label with no live worktree behind it is a stale lock —
   ask the user before taking it over; never `--force` it on your own.
2. **Drop anything blocked** on an unmerged branch or an unanswered 🔴 question.
3. **Prefer issues with an identified root cause.** An issue whose body names the file
   and the mechanism is one an agent can finish. A vague issue turns into a 166M
   exploration — the exact failure the measurement found.
4. **Prefer independent issues.** Two agents touching the same file collide on the merged
   tree even when both are green alone. Check the paths each issue implies before pairing
   them in one wave.
5. **Respect `release:` ordering** — committed before reserve before stretch, unless the
   user said otherwise.

Report the selected list before spawning anything. One line per issue: number, title,
chosen model, and why that model.

## Step 3 — One worktree per issue

Never let two agents share a checkout, and never create the worktrees from inside an
agent.

```bash
scripts/wt new <issue>      # branch + worktree off the latest default branch; claims the issue
```

`wt new` also **checks the issue out**: it applies the `status:wip` label and posts a
check-out comment, so a second `/batch` wave or a parallel session sees the issue as
taken. It refuses an issue that already carries the label. If it refuses, drop that
issue from the wave and say so in the report — `--force` is the user's call, not
yours. The label is released by `scripts/wt remove` (once the issue is closed) and
`scripts/wt prune`; `scripts/wt release <issue>` clears it by hand. If `gh` is missing or
not authenticated, `wt new` still creates the worktree and warns that no label was set.

- The WIP cap is `WT_CAP` (default 10). If the wave would exceed it, run
  `scripts/wt prune` first (it reaps worktrees whose PRs already merged), then shrink the
  wave or raise the cap deliberately (`WT_CAP=<n>`) — and say so in your report. Do
  **not** remove another session's worktree to make room.
- Each worktree's `.envrc` sets an isolated `WT_TEST_DB` and its own E2E ports
  (`WT_E2E_PORT`, `WT_E2E_DEV_PORT`). Every agent must `source .envrc` before running
  tests.
- `git stash` is **not** worktree-scoped. Tell every agent to use `scripts/wt stash`,
  never bare `git stash`.

## Step 4 — Delegate, on the cheapest model that can do the job

One agent per issue, all spawned **in a single message** so they run concurrently.

### Model choice

**Default to Sonnet.** In the measured waves Opus ran the subagents and was 1,180M of one
wave's 1,426M. Most issues do not need it.

Escalate to Opus only when the issue meets one of these, and **say which one** in your
report:

- The root cause is unknown and must be found, not just fixed.
- The fix spans three or more packages, or crosses a service boundary with a contract
  change.
- It changes the project's core domain semantics — the algorithm or protocol
  `CLAUDE.md` names as the product's hard part.
- It requires a design judgment the issue does not settle — a new interaction pattern,
  an ADR, or an open-core boundary call.

"This issue is important" is not an escalation criterion. Neither is "it is a security
fix" — a one-line permission fix with a named root cause is Sonnet work.

**Read-only gates always run on Sonnet.** `regression-check`, `security-review`,
`generated-artifact-check` read a diff and report findings. Pass `model: "sonnet"`
on the Agent call when you spawn them: the Agent tool's `model` parameter overrides the
agent file's frontmatter, and `regression-check` and `security-review` carry `model: opus`
there as their default for standalone use. The one exception is
`completeness-check`, which escalates to Opus on the same criteria listed above — it hunts
for what the diff does *not* contain, which is reasoning, not pattern-matching (see
`.claude/agents/completeness-check.md`).

### The brief

Each agent's prompt must be **self-contained**. An agent that has to rediscover context
spends its budget on cache reads of files you could have named. Include:

- The issue number, title, the **full issue body**, and **its comments**
  (`gh issue view N --comments`) — paste them; do not make the agent fetch them. Scope
  corrections live in comments. An agent briefed from the body alone builds a requirement
  that may already have been superseded, and `completeness-check` then reports the branch
  as missing it.
- Its worktree path, and the instruction to `cd` there and `source .envrc` first.
- The specific files or symbols to start from, if the issue names them.
- The exact gates that apply to this diff (from the fast-path table), and which are
  `n/a`, so the agent does not run the whole battery.
- The scoped test command — the affected test file, not the whole suite.
- The completion contract from Step 5.

Tell each agent explicitly:

- **Do not re-delegate.** A subagent executes; it does not spawn more agents.
- **Do not run the full test suite.** Run the affected file only.
- **Batch independent tool calls** into one message.
- **Stop and report** if blocked after two attempts at the same failure, rather than
  looping. A stuck agent is the 166M case.

## Step 5 — Completion contract

Every agent finishes by, in order:

1. Tests and docs in the **same commit** as the code change.
2. A changelog fragment at `changelog.d/<issue>.<type>.md`, unless the change is exempt.
3. `make pre-push` green. Log it to a **file** — piping it through `tail` swallows the
   diagnostic, and an OOM kill then reads as a bare exit code.
4. **Commit and stop — do not push yet.** Report the commit SHA and the pre-MR gate
   ledger to the orchestrator. `completeness-check` must be a fresh agent that did not
   write the branch, and a subagent cannot spawn one (no re-delegation), so the
   **orchestrator** runs it:
   - Spawn `Agent(subagent_type: "completeness-check")` on the unpushed branch, model per
     its escalation criteria (`.claude/agents/completeness-check.md`).
   - Re-brief the implementer (via `SendMessage`) to fix every BLOCKER and GAP — or defer
     a GAP the user explicitly defers to an **open** issue — in a **new commit, never an
     amend**, so the fix diff stays separable from the audited sha.
   - Decide the one further pass, per that agent's § After round 1: a full **round 2**
     (fresh Opus, not shown round 1's findings) when round 1 reported a `class-missed` or
     `collateral` BLOCKER or four or more findings; otherwise a narrow **fix-diff
     re-check** (`git diff <audited-sha>..HEAD`) when round 1 reported a BLOCKER or a fix
     commit changes executable behavior; otherwise none. Never a loop — a re-check of a
     re-check is the whack-a-mole `/pre-release` warns about. If the last pass still
     reports a BLOCKER, stop and put the choice to the user. A fix round that touched only
     docs, tests, comments, or changelog text gets no re-check; say so in the report
     rather than skipping it silently.

   Only after this does the orchestrator tell the implementer to continue.
5. **Check for a stale base, immediately before push — not at worktree creation.** The
   gates above can take long enough that another issue in the *same wave* merges first,
   and the implementer's scoped tests only ever ran against the base it started from. Run
   `git fetch origin && git log HEAD..origin/main --oneline` in the worktree. If it prints
   anything: rebase onto `origin/main`, then re-run whichever of this branch's tests and
   gates touch the surface the new upstream commits changed (schema checks if they touched
   a model, the affected test files if they touched a shared component) — not a blind
   re-run of the original scoped tests. A clean rebase is not evidence on its own: a
   textually clean merge can still combine two correct states into a wrong one.
6. Push the branch, then **open the PR itself** by running `gh pr create` in the `/mr`
   skill's format. `/mr` is `disable-model-invocation` — an agent cannot call it and must
   not try. The pre-MR security hook denies the first `gh pr create` on a source-touching
   branch. Once the gates have run, retry with the `SKIP_SECURITY_GATE=1` prefix, as its
   deny reason says.
7. Include `Closes #NNN` in the PR body, the completeness-check `## Requirements`
   table, and a `## Gates` section with one `gate: <name> — <N> findings` line per gate
   run — including `completeness-check — <N> findings (<model>; causes: …)`, plus either
   `completeness-check/fix-diff — <N> findings | n/a | skipped` or the round-2 line
   (`completeness-check — <N> findings (round 2; opus; causes: …; overlap k/N)`). `0
   findings` is a real outcome; never omit a zero, and never conflate `n/a` with
   `skipped`. If step 5 found a stale base, say what was rebased and re-verified in the
   PR's `## Notes`.
8. **Never merge**, and never enable auto-merge (`gh pr merge --auto`). Hand back the PR
   URL and stop.

The agent reports back twice: after step 4 (commit SHA and the pre-MR gate ledger,
unpushed), and at the end (PR URL, the full gate ledger, the commit SHA, and anything it
deliberately left undone).

## Step 6 — Verify before you believe it

**An agent reporting "done" is not evidence.** The known failure mode is a subagent that
stops at the first gate artifact and reports success — 3 of 5 in one measured batch.
Check every agent's actual output:

```bash
git -C <worktree> log origin/main..HEAD --oneline    # are there commits?
git -C <worktree> status --porcelain                 # anything uncommitted?
```

Then confirm the PR is real and points at the right code:

```bash
gh pr view <N> --json headRefOid,body,statusCheckRollup --jq '
  "sha=\(.headRefOid) checks=\([.statusCheckRollup[] | (.conclusion // "") + (.state // "") | if . == "" then "PENDING" else . end] | unique | join(",")) closes=\(.body | test("Closes #"))"'
```

`HEAD == PR head sha`, and the checks are those of that sha (`gh pr checks` reads the
head commit). A worktree is not private — another session can commit
and push from it mid-edit — so verify rather than assume the agent's summary describes
what landed.

An agent that produced no commit costs the same as one that shipped. Re-brief it with
what was missing, or take the issue over yourself; do not report it as done.

## Step 7 — Report

One table: issue, model used, PR, check status, commits, gate findings. Then state
plainly:

- Which issues did **not** land, and why.
- Whether you raised the WIP cap.
- Any issue `wt new` refused as already checked out, and any lock you left in place.
- The wave's shape: how many agents, how many on Opus.
- Which branches ran a completeness-check fix-diff re-check or round 2, and whether any
  stopped on a residual BLOCKER for your decision.

Remind the user that each worktree is reaped with `scripts/wt prune` after its PR
merges — nothing does that automatically. Do not merge anything. Do not start another
wave without being asked.

## Cost rules, condensed

Cache reads were 95.9% of the measured spend. Each of these cuts
`turn count × context size × fan-out`:

- **Sonnet unless the escalation criteria are met**; read-only gates always Sonnet
  (pass `model: "sonnet"` at spawn; it overrides an `opus` frontmatter default).
- **Cap the wave** (default 5, inside `WT_CAP`). Past a handful, the agents stop being
  independent.
- **Verify commits, don't trust summaries** — a wandering agent is 25× a focused one, and
  an empty one is pure loss.
- **Self-contained briefs.** Paste the issue body; name the files. Every fact an agent
  rediscovers is re-read on every later turn of that agent.
- **Scoped tests only.** Never the full suite inside an agent.
- **Pre-MR gates as one parallel batch**, never serially. Then `completeness-check` once,
  serially, before push — it audits the branch the batch's fixes produced — plus at most
  one more pass (fix-diff or round 2), never a loop.
- **Apply only the gates the diff earns** — the fast-path table is authoritative.
- **No re-delegation** from inside an agent.
- **Two-strike rule**: an agent stuck on the same failure twice stops and reports.
- **Wait on background work silently** — no filler tool calls while a task is pending.

## Rules

- **Never merge.** Not after green checks, not for a docs-only branch.
- **Never infer a `release:` label.** If an issue enters a dated milestone during this
  wave, ask which of committed/reserve/stretch applies. GitHub labels are not scoped, so
  apply the answer and remove the other two in the same call:
  `gh issue edit <N> --add-label release:committed --remove-label release:reserve,release:stretch`.
- **Never commit to the default branch**; `wt new` branches from its latest tip.
- **Never bare `git stash`** in a worktree. `scripts/wt stash`.
- If the user says to skip a gate, skip it and record it as `skipped` with their reason —
  not as `n/a`.
