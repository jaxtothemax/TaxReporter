---
name: import-spec
description: Convert a product spec, PRD, or feature list into structured GitLab issues. Parses features and phases with parallel sub-agents, confirms with user before creating anything.
disable-model-invocation: true
argument-hint: "[path/to/spec.md]"
---

# Import Specification

Convert a product spec, PRD, or feature list into structured GitLab issues.

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

## Step 4 — Create GitLab issues

Confirm the GitLab project path if not already known:
> "GitLab project path? (e.g. myorg/my-project)"

Create issues one at a time using the Feature template shape:

```bash
glab issue create \
  --title "feat: <title>" \
  --description "$(cat <<'EOF'
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

Report each issue URL as it's created.

---

## Step 5 — Create milestones (if phases detected)

If the spec had phases, create GitLab milestones first:

```bash
glab api projects/:fullpath/milestones \
  --method POST \
  -f title="<phase name>" \
  -f description="<phase description>"
```

Then re-run issue creation with `--milestone` flags.

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
- Use `glab` only — do not use the GitLab web UI or API directly
- If `glab` is not authenticated, tell the user to run `glab auth login` and stop
- Do not create duplicate issues — check existing open issues first if the project already has issues
