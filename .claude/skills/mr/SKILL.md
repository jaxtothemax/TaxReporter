---
name: mr
description: Open a GitLab MR for the current branch targeting main. Runs pre-flight checks (clean branch, changelog fragment, no duplicate MR), writes a structured description, and creates via glab.
disable-model-invocation: true
argument-hint: ""
---

# Open Merge Request

Create a GitLab MR for the current branch targeting `main`.

---

## Step 1 — Gather context & pre-flight (Sonnet sub-agents, in parallel)

Spawn these two sub-agents concurrently with `model: "sonnet"`. Wait for both.

**Agent 1 — Branch & diff analysis:**
> Run `git branch --show-current`, `git status --porcelain`,
> `git log main..HEAD --oneline`, and `git diff main...HEAD --stat`.
> Return all output verbatim. Flag prominently if porcelain output is non-empty
> (uncommitted changes).

**Agent 2 — Pre-flight checks:**
> Run these and report pass/fail for each:
> (a) **Pushed**: run `git status -sb` — check if the branch tracks a remote
>     (`origin/...`). If not, flag "branch not pushed".
> (b) **Changelog fragment**: run
>     `git diff --name-only origin/main...HEAD 2>/dev/null | grep -E '^changelog\.d/[^/]+\.(added|changed|fixed|security)\.md$'`
>     and report whether a fragment is present. Also run `ls changelog.d/` to
>     show what fragments exist.
> (c) **Branch name**: run `git branch --show-current` and verify it follows
>     `feat/`, `fix/`, `docs/`, `chore/`, `test/`, `refactor/`, `perf/`, `ci/`.
> (d) **Existing MR**: run `glab mr list --source-branch $(git branch --show-current) 2>/dev/null`
>     and report any open MRs with titles and URLs.

### Evaluate results

- **Uncommitted changes** → stop and tell the user. Do not proceed.
- **Branch not pushed** → push it: `git push -u origin $(git branch --show-current)`, then continue.
- **No changelog fragment** and branch is not exempt (`chore/*`, `ci/*`, `docs/*`) → run the
  `changelog` agent to create one, commit it, then continue.
- **Existing MR with matching title** → report the URL and stop (already open).
- **Existing MR with different title** → stop and tell the user — something is wrong.

---

## Step 2 — Write the MR description

Using the research from Step 1, produce:

**Title** (≤70 chars): conventional commit style — `type(scope): short description`.
Derive from the most significant commit or branch name.

**Body:**

```markdown
## Summary
- <what changed and why — 1–4 bullets>

## Changes
- <component / file → what it does now>

## Requirements
| Requirement (quoted from the issue, its comments, or its test plan) | Status |
|---|---|
| <criterion> | MET: <file:line or test name> |
| <criterion> | DEFERRED: #<open issue, not one this MR closes> |

## Test plan
- [ ] <specific thing to verify manually>
- [ ] <another verification step>
- [ ] Confirm CI pipeline is green

## Gates
<!-- machine-readable; one line per gate. Format: `gate: <name> — <outcome>` -->
- gate: <name> — <N> findings
- gate: <name> — 0 findings
- gate: <name> — n/a (<why this gate does not apply to this diff>)
- gate: <name> — skipped (<user's reason>)

## Notes
<migration steps, known limitations, follow-up issues — omit section if empty>
```

Rules:
- Be specific about *what* changed, not just *that* it changed
- **`## Requirements` lists every acceptance criterion and test-plan line of each closed
  issue** — including scope changes made in the issue's comments — as MET with evidence or
  DEFERRED to an open issue. It comes from the `completeness-check` agent, which runs
  before the push. A line the MR silently leaves out is the failure this table exists to
  expose. Omit the section only for chores with no issue.
- **Any follow-up, deferral, or "left open" sentence names an open issue on the same
  line.** The `mr-followups` CI job fails the pipeline otherwise; mark a line that owes
  nothing with `followup-ok` (e.g. `<!-- followup-ok -->`). Check a draft by hand with
  `bash scripts/check-mr-followups.sh --file <description.md>`.
- Add `Closes #N` after Notes if the branch resolves an issue
- Add `## Screenshots\n<!-- attach before/after -->` for UI changes
- No filler text

### The Gates section

Every MR that ran any agent gate carries this section. It costs nothing to author
— the gates already ran and their outcomes are already known — and it is the
**only** record of gate *yield*. Without it, a gate that runs on every MR and
never finds anything is indistinguishable from a gate that catches real defects:
both look like compliance. `/kaizen` parses these lines across recent MRs to find
gates that have earned a fast-path exemption.

Four rules, each of which has been broken in practice:

- **`0 findings` is a real outcome. Never omit a zero because the line looks like
  noise.** The zeros are the entire signal — they are what proves a gate has
  stopped earning its slot.
- **Never inflate `<N>`.** This ledger exists so gates can be *removed*. Padding
  it re-imposes the ceremony the fast-path table was written to strip out.
- **`n/a` and `skipped` are different states and must not be conflated.** `n/a`
  means the gate's scope excludes this diff. `skipped` means it applied and the
  user declined it.
- **"Applied, but I did not actually run it" has no token — so run it.** A gate
  marked `n/a` with a confident one-line justification is, in practice, usually an
  *unrun* gate whose justification was guessed. Two real cases: an `n/a` that hid
  a write-only field with no reader, and a fabricated `0 findings` that hid five
  genuine findings. If the gate applies, run it and report what it said.

Two conventions for gates with more than one mode:

- **A distinct second mode gets a `/<mode>` label — not a new name, and not
  parentheses.** `completeness-check/fix-diff` is the narrow re-check of the commits made
  in response to the first `completeness-check` (`.claude/agents/completeness-check.md`
  § Fix-diff re-check). The `/kaizen` parser accepts `/` and tallies the mode separately;
  it silently drops `completeness-check (fix-diff)`. The label resolves to an existing
  agent, so it is not a phantom gate.
- **`completeness-check` round 2 is the one sanctioned second line under the same name.**
  When its full round-2 audit ran, that round gets its own line with `round 2` first in
  the parenthetical:
  `- gate: completeness-check — 2 findings (round 2; opus; causes: class-missed 2; overlap 1/3)`.
  Do not invent a `completeness-check-r2` name — it resolves to no agent. `/kaizen` splits
  the two rounds by the marker. Counting rules live in the agent's § Recording it.

---

## Step 3 — Create the MR

```bash
glab mr create \
  --title "<title>" \
  --target-branch main \
  --description "$(cat <<'EOF'
<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Always use a heredoc for the body** — never inline `\n` literals. Inline `\n`
renders as literal text in GitLab descriptions.

Do not pass `--web`, `--squash`, `--remove-source-branch`, or `--yes` unless the
user explicitly requested them.

---

## Step 4 — Report and stop

Output:
```
MR created: <URL>

After it merges, reap the worktree from the main checkout:
  scripts/wt prune
```

Emit the `scripts/wt prune` line whenever the branch lives in a `scripts/wt` worktree;
omit it for a branch checked out in the main checkout. **Nothing reaps a worktree after
a forge merge**, and each one left behind counts against the WIP cap. Do not run the
prune yourself at this step: the MR has not merged, so prune would keep this worktree
anyway — and waiting for the merge is off-limits.

**Stop here.** Do not merge, do not poll the pipeline, do not post comments.
The user reviews and merges all MRs manually. CI runs automatically on push.
Use `/fix-mr` if you need to watch and fix a failing pipeline.

---

## Rules

- **Never force-push** to prepare for an MR — if the branch is behind main,
  tell the user and let them decide whether to rebase
- **Never open an MR to a branch other than main** without explicit instruction
- **Never create duplicate MRs** — check first (Step 1d)
- **Never merge after creating** — hand the URL to the user and stop
- **Heredoc syntax is mandatory** for multi-line bodies
- If `glab` is not authenticated, tell the user to run `glab auth login` and stop
