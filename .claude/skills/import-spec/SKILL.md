---
name: import-spec
description: Convert a product spec, PRD, or feature list into structured GitHub issues. Parses features and phases with parallel sub-agents, confirms with user before creating anything.
disable-model-invocation: true
argument-hint: "[path/to/spec.md]"
---

# Import Specification

Convert a product spec, PRD, or feature list into structured GitHub issues.

Usage:
```
/import-spec path/to/spec.md
/import-spec  (then paste spec content when prompted)
```

---

## Step 1 — Load the spec

If `$ARGUMENTS` is a file path, read it. Otherwise ask:

> "Paste your spec, PRD, or feature list. When done, type END on its own line."

---

## Step 2 — Parallel parsing (Sonnet sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Extract features and user stories:**
> Read the spec text provided. Extract every distinct user-facing feature,
> capability, or user story. For each, identify:
> - Title (short, imperative)
> - The user problem it solves
> - Which user type benefits (map to personas in `.claude/personas.md` if available)
> - Natural grouping / milestone phase
>
> Return a structured list. Do not invent features not in the spec.

**Sub-agent 2 — Extract milestones and phases:**
> Read the spec text. Identify any phasing, milestones, versions, or release
> stages mentioned. Return the phase structure and which features belong to each.
> If no phases are mentioned, return "no phases detected".

---

## Step 3 — Confirm with user before creating anything

Present a summary table:

```
Found X features across Y phase(s):

Phase 1 — [name or "Initial release"]:
  - feat: <title>
  - feat: <title>

Phase 2 — [name]:
  - feat: <title>

Proceed? [yes/no/edit]
```

Wait for confirmation. If the user says "edit", accept corrections before proceeding.

---

## Step 4 — Create GitHub issues

Resolve the repository from the origin remote — never hardcode it:

```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

If that fails (no origin remote yet, or origin is not on GitHub), ask:
> "GitHub repository (owner/name)? (e.g. myorg/my-project)"

and pass it to every `gh` call below as `--repo <owner/name>` (or export
`GH_REPO=<owner/name>`, which `gh issue` and `gh api` both honor). Confirm the
repository back to the user before creating anything.

Every label named below must already exist in the repository — `gh issue create` fails
on an unknown label rather than creating it. Check with
`gh label list --limit 500 --json name -q '.[].name'`; if `feature` is missing, ask
before creating it (`/kickoff` Step 4 creates the project's standard set).

**If phases were detected, do Step 5 first** — `--milestone` names an existing
milestone, and the create fails if it does not exist yet.

Create issues one at a time using the Feature template shape:

```bash
gh issue create \
  --title "feat: <title>" \
  --body "$(cat <<'EOF'
## Problem

<user problem from spec>

## Proposed solution

<feature description from spec>

## Acceptance criteria

- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] <criterion 3>

EOF
)" \
  --label "feature" \
  [--milestone "<phase name>" if phases were detected]
```

If the milestone has a due date, it is a dated milestone, and `CLAUDE.md`'s
*Milestone commitment* rule applies: ask the user which of `release:committed` /
`release:reserve` / `release:stretch` each issue carries — grouped, one question per
phase is fine — and add it to `--label` (`"feature,release:<value>"`). Never infer it.
If the user does not answer, create the issue without one and list it in the summary
as unlabeled.

Report each issue URL as it's created.

---

## Step 5 — Create milestones (if phases detected)

If the spec had phases, create GitHub milestones **before** Step 4's issues — skip any
whose title already exists (`gh api --paginate "repos/{owner}/{repo}/milestones?state=all&per_page=100" -q '.[].title'`;
`-q` runs per page, so the paginated output is already one title per line):

```bash
gh api "repos/{owner}/{repo}/milestones" \
  --method POST \
  -f title="<phase name>" \
  -f description="<phase description>"
```

Add `-f due_on="<YYYY-MM-DD>T00:00:00Z"` only if the spec gives the phase a date — a due
date is what makes it a *dated* milestone.

`{owner}/{repo}` resolve from the origin remote, or from `GH_REPO` when Step 4 had to ask.
Then create the issues with `--milestone "<phase name>"`.

---

## Step 6 — Summary

Output:
```
Created X issues across Y milestone(s):
  <issue URL> — feat: <title>
  ...

Next: run /voc all <feature description> before starting architecture on any of these.
```

---

## Rules

- Never create an issue without user confirmation of the list first
- Never invent acceptance criteria not implied by the spec — use 3 placeholder checkboxes if unclear
- Use `gh` only (`gh issue`, `gh label`, and `gh api` for milestones) — do not use the
  GitHub web UI or hand-rolled `curl` calls
- If `gh auth status` fails, tell the user to run `gh auth login` and stop
- Do not create duplicate issues — search open and closed issues first
  (`gh issue list --state all --search "<key terms>"`) if the project already has issues
