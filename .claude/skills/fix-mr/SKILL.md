---
name: fix-mr
description: Get a blocked GitHub pull request (PR) to green AND mergeable. Reads both axes of readiness (check status and mergeability), resolves conflicts with the default branch, diagnoses failing GitHub Actions checks with parallel sub-agents, applies fixes, commits, pushes, and re-checks (max 3 iterations).
disable-model-invocation: true
argument-hint: "[PR number ...]"
---

# Fix MR

In this repository an MR is a GitHub pull request (PR).

Get a blocked PR to green **and** mergeable.

**A PR is blocked on two independent axes.** The checks can be green while the branch
conflicts with the default branch, and the branch can be mergeable while a check is
red. GitHub tracks them separately — the head commit's check runs (`gh pr checks`)
versus `mergeable` / `mergeStateStatus` — and this skill covers both. Reading only the
checks is how a conflicted PR gets reported "ready to merge": upstream, that is exactly
the state an MR was in when this skill was found to be one-axis.

Usage:
```
/fix-mr            # uses the current branch's PR
/fix-mr 42         # targets PR #42
/fix-mr 42 43 47   # several: read both axes for all of them, then work them one at a time
```

---

## Step 1 — Read BOTH axes: check status and mergeability

If `$ARGUMENTS` holds PR numbers, use them. Otherwise find the open PR for the current
branch. Read JSON rather than scraping `gh pr list`'s table:

```bash
gh pr list --head "$(git branch --show-current)" --state open --json number -q '.[].number'
```

If no open PR exists, stop and tell the user. Then, for **every** PR, read the
mergeability axis:

```bash
gh pr view <PR> --json headRefName,headRefOid,state,isDraft,mergeable,mergeStateStatus,reviewDecision -q '
  "source:        \(.headRefName)",
  "head:          \(.headRefOid)",
  "state:         \(.state)",
  "draft:         \(.isDraft)",
  "mergeable:     \(.mergeable)",
  "merge_state:   \(.mergeStateStatus)",
  "review:        \(.reviewDecision)"'
```

and the checks axis, collapsed to one word:

```bash
gh pr checks <PR> --json bucket -q '[.[].bucket]
  | if length == 0 then "none"
    elif any(. == "fail" or . == "cancel") then "fail"
    elif any(. == "pending") then "pending"
    else "pass" end'
```

Read the JSON, not `gh pr checks`' exit status: it exits non-zero both for a failed
check and (exit 8) for one still pending, so a bare `if gh pr checks` conflates the two.
When the head commit has no checks at all it prints `no checks reported` instead of
JSON. Treat that as `none`.
Add `--required` to see only the checks branch protection requires — those decide
mergeability; a failing non-required check shows up as `merge_state: UNSTABLE`.

With several PRs, report the two-axis state of each **before** working any of them — a
batch where one PR is conflicted and another is red needs different treatment per PR,
and this table is what tells them apart.

Route on the pair. The axes are independent, so check both even when one of them is
already an answer:

| checks | `mergeable` / `mergeStateStatus` | Go to |
|---|---|---|
| `fail` | `MERGEABLE` | Step 2 (checks only) |
| `pass` | `CONFLICTING` / `DIRTY` | **Step 3b** (conflict only) |
| `fail` or `none` | `CONFLICTING` / `DIRTY` | **Step 3b first** — GitHub does not run `pull_request` workflows on a PR that has a merge conflict, so these checks are stale or absent until the conflict is resolved |
| `pass` | `MERGEABLE` / `BEHIND` | **Step 3b** without a conflict — branch protection requires the branch to be up to date with `main` |
| `pass` | `MERGEABLE` / `CLEAN` | Step 6 — genuinely done |
| `pending` | either | Step 5, then re-read both |
| any | `UNKNOWN` | Re-read in a few seconds — GitHub computes mergeability asynchronously after every push to the branch or to `main` |

**Read the checks from the PR's head commit, never from the branch.** `gh run list
--branch <branch>` lists runs for every commit the branch ever had, so a green run for
an older head can sit on top of the list while the current head's run has not started.
`gh pr checks` reads the head commit; when you need the runs themselves, pin them to
that exact sha:

```bash
HEAD_SHA=$(gh pr view <PR> --json headRefOid -q .headRefOid)
gh run list --commit "$HEAD_SHA" --event pull_request \
  --json databaseId,workflowName,status,conclusion
```

**A `pass` can hide a failure.** A job with `continue-on-error: true` reports success
when its steps failed, and a job skipped by an `if:` reports `skipped`, which **satisfies
a required check** of the same name. If the PR is green but something still looks wrong,
read the jobs (`gh run view <run-id> --json jobs`), not the check summary.

---

## Step 2 — Diagnose failures (parallel sub-agents)

**First, rule out a run that tested nothing.** Three shapes, none of them a code defect:

- A workflow run with conclusion `startup_failure` and no jobs failed at *creation*:
  the workflow file is invalid, or it references an action that is not allowed or a
  pinned SHA that does not exist. `actionlint` reproduces the first locally.
- Checks stuck `queued` for a long time are waiting for a runner or for the account's
  concurrent-job limit. Wait for active runs to drain.
- `none` — no runs at all for the head sha — means the PR is conflicted (Step 3b), the
  workflow's `paths:` filters excluded the change, or the head commit message carried
  `[skip ci]`.

A `cancel` from the workflow's `concurrency:` group means a newer push superseded the
run. Read the newer run, not the canceled one. Do not diagnose code against any of these.

Otherwise, launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for
both.

**Sub-agent 1 — Fetch failed job logs:**
> List the failed runs for the PR's head commit with
> `gh run list --commit "$HEAD_SHA" --event pull_request --json databaseId,workflowName,conclusion -q '.[] | select(.conclusion == "failure")'`.
> For each, fetch the failing steps' logs with `gh run view <run-id> --log-failed`.
> Return the workflow name, job name, step name, and the log tail that contains the
> failure — not the whole log.

**Sub-agent 2 — Gather context:**
> Run `git log --oneline -5` and `git diff origin/main...HEAD --stat` to understand the
> branch's changes. Read the `.github/workflows/*.yml` files defining the failed jobs.
>
> Return: recent commits, changed files, and the relevant workflow job definitions.

---

## Step 3 — Fix the root cause

Using the sub-agent results:

1. Identify the root cause of each failure
2. **A gate that reds while naming your files is often a stale base, not your diff.**
   The default branch may already have deleted the marker, renamed the symbol, or
   shipped the cap the spec asserts. Fetch and diff against it before editing the file
   the gate names.
3. Apply the fix (edit files, run formatters, update tests, etc.)
4. Verify locally:
   ```bash
   make lint    # for lint failures
   make test    # for test failures
   ```

### Step 3b — Merge conflict (`mergeable: CONFLICTING`) or a stale branch (`BEHIND`)

Not a check failure — the branch cannot merge into the default branch. It has its own
procedure because two things reliably go wrong here.

**First: check the worktree before resolving anything.** The resolution is often already
on disk, unpushed, leaving no trace on GitHub. In the issue's worktree
(`scripts/wt list`):

```bash
git status --porcelain                                    # must be clean
git rev-list --left-right --count HEAD...origin/<branch>  # LEFT=ahead RIGHT=behind
```

| ahead / behind | meaning | action |
|---|---|---|
| `N / 0` | local is strictly ahead | a plain **non-force** push clears it — done |
| `0 / N` | another session pushed | do not build on this HEAD; sync first |
| `N / M` | diverged — usually an unpushed **amend** | compare `git rev-parse HEAD^` with `git rev-parse origin/<branch>^`; identical parents mean the local commit *replaces* the remote one, and landing it needs a force-push — confirm with the user first |

**Then resolve, if there is genuinely something to resolve:**

```bash
git fetch origin
git merge origin/main
```

Prefer **merge over rebase** — it needs no force-push, so the no-force-push rule below
stays satisfied without a round trip. For `BEHIND` the merge is conflict-free; it exists
only to satisfy the "require branches to be up to date" protection rule. Do not use the
web UI's "Update branch" button for a conflict. It cannot resolve one.

**Resolve in place, between the conflict markers.** Never rebuild a conflicted file from
`git show :2:<path>`. Stage 2 is the branch's *pre-merge* blob, so copying it over the
working-tree file silently discards every hunk the merge already auto-settled elsewhere
in that same file — and `git status` still reports the file resolved. The tell is a test
failing on a symbol your change never mentions, in a block the *other* branch
contributed.

**After merging, check what a merge commonly breaks:**
- `ls changelog.d/` — a merge can leave a **duplicate** fragment
- Sequence-numbered files (migrations, ADRs, numbered rules) — these collide only on the
  *merged* tree, so both sides were green alone

Then `make pre-push` and push. A merge commit's default message is fine.

---

## Step 4 — Commit and push

Commit the fix with a descriptive message:

```bash
git add <fixed files>
git commit -m "fix(ci): <what was fixed>"
git push origin "$(git branch --show-current)"
```

---

## Step 5 — Wait and re-check

After pushing, read both axes again (the Step 1 calls). If a check is still running,
tell the user and stop — do not poll in a foreground loop. If you must wait, run a
bounded poll in the background and make no other tool calls until it reports.

If the checks have completed:
- **Green**: go to Step 6
- **Red with new failures**: go back to Step 2 (max 3 iterations)

---

## Step 6 — Confirm green AND mergeable

Re-read both axes. A fix for one axis can change the other: merging the default branch
re-runs the checks, and a new commit re-evaluates mergeability.

**Only report ready to merge when every check on the head commit is `pass` AND
`mergeable == "MERGEABLE"` with `mergeStateStatus == "CLEAN"`.** Both, every time:

```
Checks are green and the branch is mergeable. PR #<N> is ready to merge.
```

When they disagree, say so rather than reporting the good half:

```
PR #<N>: checks green, but the branch CONFLICTS with main — not mergeable.
```

`mergeStateStatus` also reports blockers this skill does not fix. `BLOCKED` means a
required review (`reviewDecision: REVIEW_REQUIRED` or `CHANGES_REQUESTED`), an
unresolved conversation, or another protection rule is unmet. `DRAFT` means the PR is
still a draft. `UNSTABLE` means a non-required check is failing. Report those verbatim
rather than calling the PR ready; they need a human.

---

## Rules

- **Check both axes before reporting anything** — green checks are half the answer; `mergeable` / `mergeStateStatus` is the other half
- **Never force-push** without user confirmation — create new commits for fixes, and merge (not rebase) to resolve conflicts
- **Max 3 fix iterations** — if the checks still fail after 3 rounds, report the remaining failures and stop. The user needs to investigate.
- **Never merge the PR** — hand back the URL and stop. The user merges manually. That
  includes `gh pr merge --auto`
- **Do not retry without a code change** unless the failure is clearly infrastructure-related (runner timeout, network error, OOM, a `startup_failure` run). Re-run only the failed jobs, with `gh run rerun <run-id> --failed`, and never repeatedly to force green
- **Verify locally before pushing** — do not use CI as a debugger
- If `gh` is not authenticated (`gh auth status` fails), tell the user to run `gh auth login` and stop
