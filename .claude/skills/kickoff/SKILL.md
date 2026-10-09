---
name: kickoff
description: Interactive project setup from this template. Asks 5 questions, populates CLAUDE.md and personas, optionally creates the standard GitHub labels and seeds GitHub issues.
disable-model-invocation: true
argument-hint: ""
---

# Project Kickoff

Interactively populate a new project from this template. Replaces placeholders,
generates real personas, and seeds initial GitHub issues.

Run when starting a new project: `/kickoff`

---

## Step 1 — Gather inputs

Ask the user these questions **one at a time**. Wait for each answer before asking
the next.

1. **Project name and description**
   > "What are you building? Give me a name and one sentence."

2. **Users**
   > "Who uses it? Describe 3–5 distinct user types — their role, what they're
   > trying to accomplish, and their biggest frustration with existing tools."

3. **Tech stack**
   > "What's the stack? (language, framework, database, deployment)"

4. **First milestone**
   > "What does the first working version do? List 4–8 user-facing features or
   > capabilities for v0.1."

5. **GitHub repository (owner/name)** (optional)
   First try to resolve it from the origin remote:
   `gh repo view --json nameWithOwner -q .nameWithOwner`. If that prints a name, offer
   it as the default; otherwise there is no origin yet, so ask outright:
   > "What's the GitHub repository (owner/name)? (e.g. myorg/my-project) — needed to
   > create labels and issues. Press Enter to skip."

   Export the answer as `REPO`, and verify it exists with the read-only
   `gh repo view "$REPO" --json nameWithOwner`. If it does not exist yet, say so and
   treat the answer as skipped — creating the repository (and its `origin` remote) is
   the owner's call, not this skill's.

---

## Step 2 — Parallel setup (Sonnet sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Read current file state:**
> Read `CLAUDE.md` and `.claude/personas.md` in full.
> Return the complete content of both files verbatim so the next step can
> make targeted replacements.

**Sub-agent 2 — Research the domain** (only if project description suggests a
known domain):
> Based on the project description, identify 2–3 standard user archetypes for
> this domain and their typical pain points. Return a brief summary — this will
> inform persona generation.

---

## Step 3 — Generate content (you do this — do NOT delegate)

Using the user's answers and the sub-agent research:

### 3a. Update `CLAUDE.md`

- Replace every instance of `[PROJECT NAME]` with the actual project name
- Fill in the **General conventions** section with the tech stack
- Fill in or update the **Personas** section with the inline persona summaries
  (short form: name, role, workflow, pain point, values — one bullet each)
- Remove the SETUP CHECKLIST comment block
- Remove any `[REMOVE IF NOT APPLICABLE]` sections that don't apply to this stack

### 3b. Generate `.claude/personas.md`

Write 3–5 full personas using the user's descriptions. Each persona:

```markdown
## <Name> — <Role/Archetype>

**Background:** <1–2 sentences>
**Technical level:** <Beginner / Intermediate / Advanced>
**Primary goal:** <What they're trying to accomplish>
**Pain points:** <What frustrates them about existing tools>
**Values:** <What matters most: speed? reliability? simplicity? control?>
```

Make them specific. Generic personas produce generic feedback from `/voc`.

### 3c. Prepare seed issues (if a GitHub repository was provided)

For each feature in the milestone list, draft a `gh issue create` command using
the Feature issue template shape:
- Title: `feat: <feature name>`
- Body: problem, proposed solution, acceptance criteria (3 checkboxes)
- Label: `feature`

---

## Step 4 — Write files and create issues

1. Write the updated `CLAUDE.md`
2. Write the updated `.claude/personas.md`
3. If a GitHub repository was provided, create the project's standard labels — **show
   the list and get a yes first**. GitHub has no scoped (`key::value`) labels and does
   not create a label on first use: `gh issue create` and `gh issue edit` fail on a
   label name the repository lacks, so every skill that applies one depends on this
   set existing. Skip any that already exist (a new repository already has `bug`):
   ```bash
   existing="$(gh label list --repo "$REPO" --limit 500 --json name -q '.[].name')"
   while IFS='|' read -r name color desc; do
     if printf '%s\n' "$existing" | grep -qxF "$name"; then echo "exists: $name"; continue; fi
     gh label create "$name" --repo "$REPO" --color "$color" --description "$desc"
   done <<'LABELS'
   feature|1f6feb|New user-facing capability
   bug|d73a4a|Something is broken
   task|8250df|Chore, tooling, or other non-feature work
   feedback|0e8a16|Report or feedback from a real user
   release:committed|b42318|Ships, or the release slips (one release:* label per issue)
   release:reserve|b54708|Slot held for inbound work from real users (one release:* label per issue)
   release:stretch|6e7781|Ships if there is time; moves out at feature freeze (one release:* label per issue)
   status:wip|fbca04|Checked out by scripts/wt; another session is working on it
   no-changelog|cfd3d7|PR needs no changelog fragment; the changelog-check job skips it
   LABELS
   ```
   The three `release:*` labels are mutually exclusive by convention only — see
   *Milestone commitment* in `CLAUDE.md`. Whenever one is applied, the other two are
   removed in the same `gh issue edit` call.
4. Then create issues one at a time:
   ```bash
   gh issue create --repo "$REPO" \
     --title "feat: <feature>" \
     --body "$(cat <<'EOF'
   ## Problem
   <description>

   ## Acceptance criteria
   - [ ] <criterion>
   EOF
   )" \
     --label "feature"
   ```
   Report each issue URL as it is created. Seed issues go in no milestone: placing
   one in a dated milestone would need a `release:*` decision this skill does not ask
   for — `/dotplanning` makes that call at milestone kickoff.

---

## Step 5 — Run customize check and report

```bash
make customize
```

Show the output and summarize what remains to be configured manually (GitHub
settings — branch protection on `main` with the required status checks, GitHub Pages
source set to "GitHub Actions", Actions workflow permissions — plus Makefile targets and
the app-specific CI jobs in `.github/workflows/`).

---

## Rules

- Do not invent features — use exactly what the user listed
- Do not create labels or issues without the GitHub repository confirmed and verified
  to exist
- Never hardcode the repository in a command — use the confirmed `$REPO` (or the
  origin remote, which `gh` resolves on its own)
- Personas must use the user's language and domain — do not genericize them
- Write files before creating issues — never create issues then fail on file writes
- If `make customize` is not available, report remaining gaps manually
