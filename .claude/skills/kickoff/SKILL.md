---
name: kickoff
description: Interactive project setup from this template. Asks 5 questions, populates CLAUDE.md and personas, optionally seeds GitLab issues.
disable-model-invocation: true
argument-hint: ""
---

# Project Kickoff

Interactively populate a new project from this template. Replaces placeholders,
generates real personas, and seeds initial GitLab issues.

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

5. **GitLab project path** (optional)
   > "What's the GitLab project path? (e.g. myorg/my-project) — needed to create
   > issues. Press Enter to skip."

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

### 3c. Prepare seed issues (if GitLab path provided)

For each feature in the milestone list, draft a `glab issue create` command using
the Feature issue template shape:
- Title: `feat: <feature name>`
- Description: problem, proposed solution, acceptance criteria (3 checkboxes)
- Label: `~feature`

---

## Step 4 — Write files and create issues

1. Write the updated `CLAUDE.md`
2. Write the updated `.claude/personas.md`
3. If GitLab path was provided, create issues one at a time:
   ```bash
   glab issue create \
     --title "feat: <feature>" \
     --description "$(cat <<'EOF'
   ## Problem
   <description>

   ## Acceptance criteria
   - [ ] <criterion>
   EOF
   )" \
     --label "feature"
   ```

---

## Step 5 — Run customize check and report

```bash
make customize
```

Show the output and summarize what remains to be configured manually (GitLab
settings, Makefile targets, CI includes).

---

## Rules

- Do not invent features — use exactly what the user listed
- Do not create issues without the GitLab path confirmed
- Personas must use the user's language and domain — do not genericize them
- Write files before creating issues — never create issues then fail on file writes
- If `make customize` is not available, report remaining gaps manually
