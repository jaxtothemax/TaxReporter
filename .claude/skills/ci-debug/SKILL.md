---
name: ci-debug
description: Diagnose a failing CI pipeline. Fetches failed job logs with parallel sub-agents, identifies the root cause, and prescribes a specific fix.
argument-hint: "[pipeline ID or MR number]"
---

# CI Debug

You are diagnosing a failing CI pipeline. Your job is to identify the root cause and give a specific fix.

## What to do

Given the pipeline ID, MR number, job name, or error description in `$ARGUMENTS`:

### 1. Fetch failure context (parallel sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Pipeline logs:**
> Use `glab` to fetch the failing pipeline's job logs. Steps:
> 1. If given an MR number: `glab ci list --per-page 1` or `glab ci view` to find the pipeline
> 2. List jobs: `glab ci list` for the pipeline
> 3. Fetch the log of each failed job: `glab ci view <job-id>`
>
> Return the full log output of every failed job. Include the job name and stage.

**Sub-agent 2 — Recent changes:**
> Run `git log --oneline -10` and `git diff HEAD~1 --stat` to identify what changed recently.
> Also read the `.gitlab-ci.yml` and any `ci/*.yml` files to understand the pipeline structure.
>
> Return: recent commits, changed files, and the CI job definitions for context.

### 2. Identify the stage and job

Map the failure to one of the project's CI jobs. Common patterns:

| Stage | Common failures |
|---|---|
| lint | Linter violations, type errors |
| test | Failing tests, coverage threshold |
| security | CVE in dependency, GPL license |
| build | Dockerfile syntax, compile error |
| changelog | Missing changelog fragment |

### 3. Diagnose the root cause
- For test failures: identify the specific test and why it fails
- For lint failures: identify the rule violation and file/line
- For coverage failures: identify which files lack coverage
- For build failures: identify the build step that failed

### 4. Do not retry blindly
Never suggest re-running the pipeline without a code change unless the failure is clearly infrastructure-related.

### 5. Prescribe a specific fix
Give the exact file and change needed.

### 6. Verify locally
Suggest the local command to reproduce and verify:
```bash
make lint    # for lint failures
make test    # for test failures
```
