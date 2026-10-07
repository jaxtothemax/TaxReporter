---
name: ci-debug
description: Diagnose a failing GitHub Actions run. Fetches failed job logs with parallel sub-agents, identifies the root cause, and prescribes a specific fix.
argument-hint: "[run ID, PR number, or workflow name]"
---

# CI Debug

You are diagnosing a failing CI run. CI here is GitHub Actions: a **workflow** file in
`.github/workflows/` produces one **run** per triggering event (a `pull_request`, a push
to `main`, a `v*` tag, a schedule), and each run has **jobs** made of **steps**. Every
job reports back to the commit as a **check**. Your job is to identify the root cause
and give a specific fix.

## What to do

Given the run ID, PR number, workflow or job name, or error description in `$ARGUMENTS`:

### 1. Fetch failure context (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Run logs:**
> Use `gh` to fetch the failing run's job logs. Steps:
> 1. Find the run. Given a run ID, use it. Given a PR number, take the PR's head commit
>    (`gh pr view <N> --json headRefOid -q .headRefOid`) and list its runs:
>    `gh run list --commit <sha> --json databaseId,workflowName,event,status,conclusion`.
>    Given nothing, use the latest failed runs on the current branch:
>    `gh run list --branch "$(git branch --show-current)" --status failure --limit 5`.
>    Pin to one commit sha; runs for older commits on the branch are not this failure.
> 2. List the run's jobs and steps: `gh run view <run-id> --json jobs`
> 3. Fetch the log of each failed step: `gh run view <run-id> --log-failed`
>    (`gh run view --job <job-id> --log` for a whole job)
>
> Return the log output of every failed step. Include the workflow, job and step names,
> and the run's event (`pull_request`, `push`, `schedule`, tag push).

**Sub-agent 2 — Recent changes:**
> Run `git log --oneline -10` and `git diff HEAD~1 --stat` to identify what changed recently.
> Also read the `.github/workflows/*.yml` files (and any `.github/actions/*/action.yml`
> they use) to understand the CI structure.
>
> Return: recent commits, changed files, and the workflow job definitions for context.

### 1b. Rule out a run that tested nothing

Before reading any log, check for these. None of them is a code defect:

- **`startup_failure`** — the run failed before any job started. The workflow YAML is
  invalid, or it references an action that is not allowed or a pinned SHA that does not
  exist. Run `actionlint` locally.
- **Stuck in `queued`** — the job is waiting for a runner or for the account's
  concurrent-job limit.
- **`cancelled`** by a `concurrency:` group — a newer push superseded the run. Read the
  newer run instead.
- **No run at all** — `pull_request` workflows do not run on a PR that has a merge
  conflict, a `paths:` filter excluded the change, or the commit carried `[skip ci]`.

### 2. Identify the workflow and job

Map the failure to one of the project's workflows and jobs. Common patterns:

| Workflow | Common failures |
|---|---|
| `governance.yml` | A governance gate or its `--self-test`, missing changelog fragment (`changelog-check`), a follow-up with no open issue (`pr-followups`), shellcheck |
| `ci.yml` (once the app stack exists) | Linter violations, type errors, failing tests, coverage threshold, compile error |
| `security.yml` | CVE in a dependency (`osv-scan`), a committed secret (`gitleaks-scan`). A scheduled run can go red with no code change, because a new advisory was published |
| `docs.yml` | Site build failure, broken internal link, Pages deploy permissions |
| `release.yml` | `release-pipeline-gate` found no green checks on `main` for the tagged commit; missing `docs/releases/<tag>.md` |

### 3. Diagnose the root cause
- For test failures: identify the specific test and why it fails
- For lint failures: identify the rule violation and file/line
- For coverage failures: identify which files lack coverage
- For build failures: identify the build step that failed
- For permission errors (`Resource not accessible by integration`, HTTP 403): the job's
  `permissions:` block does not grant what the step needs. Grant the narrowest scope,
  on that job only — never widen the workflow default
- For `pull_request` runs from a fork: secrets are not available, and `GITHUB_TOKEN` is
  read-only. Never "fix" this with `pull_request_target`

### 4. Do not retry blindly
Never suggest re-running the workflow without a code change unless the failure is clearly
infrastructure-related. When it is, re-run only the failed jobs:
`gh run rerun <run-id> --failed`.

### 5. Prescribe a specific fix
Give the exact file and change needed.

### 6. Verify locally
Suggest the local command to reproduce and verify:
```bash
make lint              # for lint failures
make test              # for test failures
make pre-push-checks   # for governance gates: it mirrors every locally-runnable one
actionlint             # for workflow syntax and expression errors
```
