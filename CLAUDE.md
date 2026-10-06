# [PROJECT NAME] — Claude Instructions

<!--
SETUP CHECKLIST — complete before first use, then delete this block:
[ ] Replace [PROJECT NAME] with your project name throughout
[ ] Define personas in the Personas section (3–5 is ideal)
[ ] Fill in tech stack in General conventions
[ ] Set test directory paths in General conventions
[ ] Set docs directory paths in Documentation conventions
[ ] Set API stability version in Backward compatibility (or remove section if pre-1.0)
[ ] Remove sections marked [REMOVE IF NOT APPLICABLE]
[ ] Remove all HTML comments once setup is complete
-->

---

## Personas

<!--
Personas power the /voc command and voc agent. Each persona should capture:
  - Role and context (who are they, what is their day like?)
  - Primary workflow (what do they use this product for?)
  - Biggest pain point (what frustrates them most today?)
  - What they value most (speed? accuracy? control? simplicity?)

3–5 personas is the right number. Too few misses perspectives; too many dilutes the signal.

Example set for a project management tool:

- **Maya** (Project Manager, mid-size team): plans sprints, monitors progress, needs at-a-glance status across 8 simultaneous workstreams. Values: speed and overview. Pain: too many context switches, can't see the whole picture in one place.
- **Jordan** (Senior Engineer, power user): lives in the board all day, uses keyboard shortcuts, relies on the audit trail for incident retrospectives. Values: accuracy, keyboard nav, full history. Pain: anything that interrupts flow or hides information.
- **Sam** (Designer, occasional user): checks in a few times a week to update card status and add notes. Values: intuitive UI that requires no training. Pain: features that assume daily familiarity.
- **Alex** (IT Admin): provisions users, manages SSO, monitors usage, handles onboarding. Values: control, visibility, low maintenance. Pain: anything requiring manual intervention at scale.
-->

- **[Name]** ([Role]): [context, workflow, values, pain point]
- **[Name]** ([Role]): [context, workflow, values, pain point]
- **[Name]** ([Role]): [context, workflow, values, pain point]

---

## Secure code — always on

Apply these to all new code and any existing code touched in a change. CI enforces a subset automatically — do not rely on it as the first line of defense.

**Backend:**
- **No raw SQL** — always use the ORM or parameterized queries; never string-interpolate user input into a query
- **Input validation at the boundary** — validate and sanitize at the API/serializer layer, not in views or models
- **Never log sensitive fields** — passwords, tokens, emails, and PII must not appear in log statements
- **Use `secrets` not `random`** for any token, key, or nonce generation
- **Flag `shell=True`** — any `subprocess` call with `shell=True` must have an inline comment explaining why it is safe; prefer list-form args
- **No hardcoded credentials** — secrets come from env vars only; never commit `.env` files or literal key values
- **Object-level authorization** — when fetching a resource by PK, always confirm the requesting user has access to that specific object (IDOR prevention)

**Frontend:**
- **No `dangerouslySetInnerHTML`** unless content is sanitized server-side and the reason is documented inline

---

## Branching model — GitLab Flow

This project follows [GitLab Flow](https://docs.gitlab.com/ee/topics/gitlab_flow.html) with environment branches:

```
feature branch ──MR──► main (staging) ──merge──► production
                         ▲                           │
                         └── hotfix (cherry-pick) ───┘
```

### Branches

| Branch | Purpose | Deploys to | Protected |
|---|---|---|---|
| `main` | Integration branch — latest accepted code | Staging / QA | Yes — no direct push, MR only |
| `production` | Stable release — what users run | Production | Yes — no direct push, MR only |
| `feat/*`, `fix/*`, `docs/*`, `chore/*` | Short-lived feature/fix branches | — | No |

<!--
[REMOVE IF NOT APPLICABLE] For projects that need a pre-production gate:

| `pre-production` | Release candidate gate | Pre-production | Yes — MR only |

Flow becomes: feature → main → pre-production → production
-->

### Workflow

**Feature development:**
1. `git checkout main && git pull origin main`
2. `git checkout -b <prefix>/<short-description>`
3. Make changes, commit, push branch
4. Open MR targeting `main`, wait for a **green pipeline**, then merge
5. `main` auto-deploys to staging for verification

**Promoting to production:**
1. When `main` is verified on staging, open an MR from `main` → `production`
2. This MR should be a fast-forward or clean merge — never rebase or squash
3. Wait for the pipeline, then merge
4. `production` auto-deploys to production
5. Tagging and the GitLab release are a manual step, run right after the release MR
   merges — `git tag vX.Y.Z && git push origin vX.Y.Z`, then
   `glab release create vX.Y.Z --notes-file docs/releases/vX.Y.Z.md` (see the `release`
   skill's Step 5 and `website/src/content/docs/guides/release-workflow.md`). If this
   project uses the full variant with a `production` branch, tag on `production`
   instead of `main`.

**Hotfixes:**
1. Branch from `main` (not `production`) — upstream first, always
2. Open MR targeting `main`, fix, merge
3. Cherry-pick the fix commit to `production`: `git cherry-pick <sha> && git push`
4. If the fix is urgent and can't wait for staging verification, branch from `production` instead, but immediately backport to `main` after

**Rules:**
- **Never merge `production` back into `main`** — changes flow downstream only
- **Never commit directly to `main` or `production`** — all changes go through MRs
- **Never merge an MR with a failing pipeline** — fix the root cause; never bypass CI

### When to adopt each variant

**Start with the simple variant** (feature → main → tag) when:
- The project is pre-1.0 or in a rapid iteration phase (alpha, beta, RC)
- There are no users depending on a stable deployed instance
- "Release" means cutting a tag, not deploying to a running service
- The team is small and every merge to `main` is implicitly a release candidate

Simple variant workflow:
1. Feature branch → MR → `main`
2. Tag `main` for releases: `git tag vX.Y.Z`

**Adopt the full GitLab Flow** (feature → main → production) when:
- Users depend on a running instance and unverified changes must not reach them
- You need to accumulate multiple MRs on `main` before promoting to production
- You're maintaining patch releases (e.g. 1.0.x) while developing the next minor (1.1)
- Hotfixes need to reach production without carrying unrelated in-progress work from `main`

**The transition is simple** — when you're ready:
1. `git checkout main && git checkout -b production && git push -u origin production`
2. Protect the `production` branch in GitLab settings
3. Uncomment the `deploy-production` job in `.gitlab-ci.yml`

There is no migration, no history rewrite, and no disruption. The `production` branch starts as a copy of `main` and diverges naturally as you begin promoting selectively.

## General conventions

- Branch naming: `feat/`, `fix/`, `docs/`, `chore/`
- **Changelog entries use fragment files** — create `changelog.d/<slug>.<type>.md` instead of editing `CHANGELOG.md` directly. Valid types: `added`, `changed`, `fixed`, `security`. Fragments are assembled at release time.
- **Tests and docs go in the same commit as the code change** — never as a follow-up commit or separate MR. A code change without its test update is incomplete:
  - Frontend tests: `[FILL IN: e.g. frontend/src/test/]`
  - Backend tests: `[FILL IN: e.g. backend/app/tests/]`
  - Documentation: `[FILL IN: e.g. docs/]`
- **Grep before renaming any symbol, field, or env var** — run `grep -r 'old_name' .` across the full repo (including CI config, docs, and test files) before committing the rename. Missing a shadow copy in a test fixture or CI job env block is the most common failure class in batch commits.
- **Declare a load-bearing call site in `load-bearing.declarations`** — when a guard, hook, filter, or validator is wired in by exactly **one** line, and deleting that line leaves the whole suite green, add a stanza there. `scripts/check-load-bearing.sh` (pre-push + CI) then fails when that line disappears. This is the only failure class where nothing else in the harness goes red: the guard stops guarding, silently, and every test keeps passing. Do not declare ordinary code — the test for a declaration is to delete the line and run the suite, not to reason about it
- Use **US English** everywhere — "color" not "colour", "canceled" not "cancelled", "authorization" not "authorisation"
- When writing complex business logic (transactions, permission checks, non-obvious sequencing), add a comment explaining **why** — not what, but the intent or constraint

**Tech stack:** [FILL IN: e.g. Python 3.12 / Django 5 / PostgreSQL 16 / React 18 / TypeScript / Vite]

---

## Git workflow discipline

These rules prevent common workflow failures that waste CI cycles and cause merge conflicts:

- **Always use heredoc syntax for multi-line strings** — git commit messages, MR descriptions (`glab mr create --description`), and any shell command that takes a multi-line argument. Inline `\n` is not interpreted as a newline by the shell and renders as literal text. Correct pattern:
  ```bash
  glab mr create --title "..." --description "$(cat <<'EOF'
  ## Summary
  - bullet one
  EOF
  )"
  ```
- **Never auto-merge MRs** — agents and skills must create the MR and stop. The user reviews and merges all MRs manually
- **Always branch from `main`** — never branch from another feature branch, even if your work depends on it. If you need changes from an unmerged branch, wait for it to land in `main` first
- **Fetch before comparing to remote** — when checking whether local and remote branches diverge, always `git fetch origin` first. Stale local refs cause false conclusions
- **Rebase sequence for batched MRs** — when merging a series of related MRs in order, after each MR lands: pull `main`, rebase the next branch onto `main`, run its tests, force-push, then hand back for merge
- **Pre-release is a one-time gate, not a fix loop** — `/pre-release full` runs all agents once to produce a report. Fix issues in separate commits, then re-run only if a full re-audit is warranted. Do not run `/pre-release full` iteratively to verify each fix
- **Parallel/multi-issue work uses `scripts/wt`** — for concurrent issues or parallel agent sessions, create an isolated git worktree with `scripts/wt new <issue>`. It branches off the latest `origin/main` into a sibling `../<repo>-wt/` dir, auto-detects and symlinks dev-dep dirs (`.venv`, `node_modules`, etc.) back to the main checkout, and shares the Docker stack via `COMPOSE_PROJECT_NAME`. WIP cap is 10 (warns at 8; raise it per invocation with `WT_CAP` for a deliberate burst). Each worktree's `.envrc` exports its own test database (`WT_TEST_DB`) and E2E server ports (`WT_E2E_PORT`, `WT_E2E_DEV_PORT`) — `source .envrc` before running tests. `wt new` / `wt claim` **check the issue out** — a `status::wip` scoped label plus a check-out comment (`WT_LOCK_LABEL` to rename) — and refuse an issue already checked out unless `--force`; `wt prune`, `wt remove` (once the issue is closed) and `wt release <issue>` clear it, and `/batch` skips labeled issues. **Nothing reaps a worktree after a forge merge**: from the main checkout, `scripts/wt prune` removes every worktree whose branch merged and was deleted on origin — whether it landed as a merge commit, a rebased or amended tip, or a squash — and `scripts/wt remove <issue>` removes one. This prevents one session's `git checkout` from swapping the working tree under another. The script is layout-agnostic and needs no customization; run `scripts/wt help` for all subcommands.

---

## Milestone commitment — every issue in a dated milestone carries one `release::` label

A milestone with a date is a promise, and a few hundred issues against one date
is not a plan. State the shape of that promise with one **scoped** label per
issue. Scoped labels (`key::value`) are mutually exclusive in GitLab, so an issue
holds exactly one of these and the tracker enforces it:

| Label | Meaning |
|---|---|
| `release::committed` | Ships, or the release slips. The **only** issues that appear as bullets in a public roadmap's section for that milestone. |
| `release::reserve` | A slot held against inbound work from real users. Spent when someone real hits something. The reserve is a number written on the milestone, not a sentiment. |
| `release::stretch` | Stays in the milestone and ships if there is time. Moves to the next milestone at feature freeze without discussion. Never a roadmap bullet. |

- **When an issue moves into the current dated milestone — whether you file it
  there, re-milestone it, or a script places it — stop and ask the user which of
  the three applies. Never infer it.** The commitment state is the user's call
  every time: a guessed `release::committed` is a promise nobody made, and a
  guessed `release::stretch` quietly drops work the user meant to ship. If the
  user's own instruction already names the label, apply it without asking. If the
  user does not answer, **leave the issue unlabeled and say so** — an unlabeled
  issue in a dated milestone is a visible gap, a guessed label is an invisible one.
- Changing an issue's commitment means applying the new value; the scoped key
  drops the old one. Do not stack them.
- Whatever label the project uses for intended-but-unmilestoned work is not a
  fourth value on this axis. Reason tags (`0.X-hardening` and the like) coexist
  with any of the three.
- A bucket rule is fine for the **first** pass over an existing milestone
  (charter work → committed, other bugs → reserve, polish and unclaimed features
  → stretch). It is not a substitute for asking on each subsequent move.

## Testing conventions

- **Run scoped tests before committing** — run the affected test file(s) locally before every `git commit`. Run your type checker (`make typecheck`) after any typed language change — it catches fixture and interface drift that behavioral tests miss. Do not treat CI as the first line of defense.
- **Grep for changed string literals** across all test files when renaming UI copy: `grep -r 'old text' [FILL IN: test dir]/`
- **Stale mocks fail silently** — if a module's exported API changes (new function, renamed arg), every test file mocking that module must be updated in the same commit

<!-- [REMOVE IF NOT APPLICABLE] Django threaded test convention -->
<!--
### Threaded tests — always close DB connections
Any test that spawns threads touching the ORM must call the DB connection cleanup before the thread returns.
Why: thread-local connections remain open after the thread exits, causing teardown to fail when dropping the test database.
-->

---

## Documentation conventions

- Docs live in the repo alongside the code — never in a separate repo
- When writing or updating documentation, invoke `/docs`
- Docs root: `[FILL IN: e.g. docs/]`

### Version-status tense — past-tense claims reference shipped versions only

A phrase anchoring behavior to a version — "shipped in X.Y", "added in X.Y", "X.Y
introduced Z" — may use past or present tense **only if X.Y is at or below the latest
shipped release**. For unshipped versions use future tense: "ships in X.Y", "planned for
X.Y", "coming in X.Y".

- **Single source of truth:** the roadmap page. Every other doc derives its tense from
  what that page says is Shipped / Underway / Planned.
- **Exception:** ADRs are design-decision artifacts — "X.Y will ship Z" is correct there.
- **Before publishing:** grep the docs tree for the version string and verify every
  occurrence matches the roadmap's classification.

This prevents the failure where a banner and a feature page drift into past tense for a
version that has not tagged, because nothing bound them to a single source. A wrong tense
on a version claim is a user-facing accuracy bug, not a style preference — there is no
fast-path exemption.

<!-- [FILL IN] Version callout convention — uncomment and adapt -->
<!--
- New features: add `> **Added in X.Y**` immediately after the section heading
- Changed/fixed behavior: no callout
- Patch releases: no callout — only minor releases and pre-releases get callouts
-->

---

## CLAUDE.md and auto memory — two complementary systems

Claude Code uses two persistence mechanisms that serve different purposes:

| | `CLAUDE.md` | Auto memory (`~/.claude/projects/…/memory/`) |
|---|---|---|
| **Written by** | You (intentionally) | Claude (automatically, from corrections and confirmations) |
| **Scope** | Everyone on the project | Your machine only |
| **What goes here** | Conventions, rules, architecture decisions, agent workflow | User-specific preferences, corrections Claude should remember, session learnings |
| **Committed to git** | Yes | No |

**Rules:**
- Keep `CLAUDE.md` focused on *durable project rules* — things that apply to everyone
- Let auto memory accumulate *individual learnings* — Claude will write these itself when it observes corrections or confirmations
- Review auto memory periodically with `/memory` to prune stale entries
- Never duplicate content between `CLAUDE.md` and auto memory; if a rule belongs to everyone, it belongs in `CLAUDE.md`

**`@path` imports** — `CLAUDE.md` can embed the content of any other file using `@path/to/file` on its own line. Use this to keep the root `CLAUDE.md` concise while storing detailed reference material in separate files:

```markdown
<!-- In CLAUDE.md -->
See @docs/api-conventions.md for REST API rules.
See @frontend/CLAUDE.md for design system conventions.
```

**Nested `CLAUDE.md` files** are the real path-scoping mechanism — Claude Code has no
`paths:`-glob loader; a directory of standalone rule files with frontmatter like that is
a convention from a different tool and is never read. What actually loads automatically,
besides the root file, is a `CLAUDE.md` placed **inside the directory it governs**: it is
pulled in whenever Claude reads or edits a file under that directory, keeping
stack-specific rules out of the root file without adding a second loader to learn.

```
scripts/CLAUDE.md    <- loads when editing anything under scripts/
frontend/CLAUDE.md   <- loads when editing anything under frontend/
```

Blueprint ships this pattern two ways:

- **`scripts/CLAUDE.md`** is live today — real rules for this repo's own CI gate
  scripts (`ci/CLAUDE.md` is a one-line `@` import of it, so `ci/**` picks up the same
  rules without duplicating them).
- **`backend/CLAUDE.md.example`, `frontend/CLAUDE.md.example`, `tests/CLAUDE.md.example`**
  are portable rule sets with nowhere to live yet — Blueprint ships no application code,
  so there is no `backend/` or `tests/` tree to put a real `CLAUDE.md` in. Once your
  project creates one, **move** (not copy) the matching `.example` file into it and
  rename to `CLAUDE.md`.

A glob that does not map to one real directory — "every `*.test.*` file, wherever it
lives" — cannot be expressed this way; put that content in the nearest directory that
actually contains those files, or fall back to an `@path` import from the root file if
the content is short enough to always load.

**A rules file that every branch appends to must become an index.** A path-scoped
`CLAUDE.md` that collects one numbered rule per UI or API branch grows without bound and
is loaded whole on every matching session. Upstream, `packages/web/CLAUDE.md` reached
457 KB and was edited by 112 of 545 merges in 30 days. It also becomes the batch's
guaranteed merge conflict. Once that happens, restructure it:

- Keep **one index line per rule** in the `CLAUDE.md` — the rule's number and its bold
  headline, plus the operative clause where the headline is only a label — linking to
  its full text in a separate file (`docs/design/invariants/<N>-<slug>.md`). Upstream,
  the index dropped from 457 KB to 56 KB with every rule number unchanged.
- Mark the index `merge=union` in `.gitattributes`, so concurrent additions stop
  conflicting.
- Union merge hides three defects that now exist **only on the merged tree**: a
  duplicate number, a line doubled because two branches edited the same rule, and an
  index line whose body file did not come with it. Gate all three, and run that gate in
  `/mass-merge` Phase A.

The same reasoning applies to any registration point every feature touches: register
one entry per line, as `make pre-push-checks` does.

---

## Claude Code settings reference

`.claude/settings.json` controls Claude Code behaviour at the project level. All keys shown below are optional — omit any you want to leave at the default. The template ships with safe defaults pre-configured.

```jsonc
{
  // Context loading
  // Glob patterns to exclude from auto-loaded CLAUDE.md context.
  // Use for generated files, vendored code, or large directories
  // you never want Claude to read automatically.
  "claudeMdExcludes": [],           // e.g. ["vendor/**", "*.generated.*", "dist/**"]

  // Effort and reasoning
  // Token budget for reasoning steps. "low" = faster and cheaper;
  // "high" = deeper analysis for complex tasks; "normal" suits most work.
  "effortLevel": "normal",          // "low" | "normal" | "high"
  // Force extended thinking on every response. Leave false unless the
  // project work is consistently complex enough to justify the cost.
  "alwaysThinkingEnabled": false,

  // Shell
  // Which shell tool Claude uses. Only "bash" or "powershell" are valid —
  // not a path, and not zsh/fish. Omit to keep the default.
  "defaultShell": "bash",           // "bash" | "powershell"

  // Sandboxing
  // Run Bash commands inside a sandbox (macOS Seatbelt / Linux seccomp).
  // Prevents writes outside the project dir and network access.
  // Enable for security-sensitive projects; disable if your build
  // commands need broader access. Must be an object, not a boolean.
  "sandbox": { "enabled": false },

  // Permissions
  // Allow / deny / ask rules for tool calls. The template ships with safe
  // defaults: read-only tracker + git queries are allowed; force-push,
  // auto-merge, and reading secrets (.env, *.pem) are denied. Rules match
  // "Tool(pattern)" — a trailing wildcard prefix-matches, written either as
  // a space before the star ("Bash(git push --force *)") or a colon
  // ("Bash(git push --force:*)"); both forms are equivalent. No wildcard
  // means an exact-command match.
  "permissions": {
    "allow": [],                  // e.g. ["Bash(make test)", "Bash(glab mr list *)"]
    "ask": [],                    // prompt before running — e.g. ["Bash(git push *)"]
    "deny": []                    // never allowed — e.g. ["Read(./.env)", "Bash(glab mr merge *)"]
  },

  // Hook security
  // HTTP URLs that Claude Code is permitted to POST to when a hook
  // uses "type": "http". Any URL not in this list is blocked.
  "allowedHttpHookUrls": [],        // e.g. ["https://hooks.example.com/claude"]

  // Plugins — both are objects (records), not arrays
  "enabledPlugins": {},             // e.g. { "my-plugin@my-marketplace": true }
  "extraKnownMarketplaces": {}      // e.g. { "my-marketplace": { "source": { "source": "github", "repo": "org/repo" } } }
}
```

The shipped `.claude/settings.json` omits `defaultShell`, `sandbox`, `enabledPlugins`
and `extraKnownMarketplaces` entirely — the defaults are what the template wants, and an
empty `[]` or bare `false` in those slots fails schema validation and is ignored with a
warning.

### Hook types

Hooks support two delivery mechanisms:

**`"type": "command"`** — runs a local shell script. The tool event JSON is available on stdin and as `$CLAUDE_TOOL_INPUT`.

**`"type": "http"`** — POSTs the event JSON to a webhook URL. The URL must be listed in `allowedHttpHookUrls`.

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        {
          "type": "http",
          "url": "https://hooks.example.com/claude",
          "timeout": 5
        }
      ]
    }
  ]
}
```

### Hook output contract — differs by event; verify it, don't guess it

A `command` hook talks back to Claude two ways: its exit code, and (on exit 0, or exit 2
for a block) a JSON object on stdout under `hookSpecificOutput`. **The available fields
differ per event, and guessing one event's shape for another is the most common way a
hook silently does nothing.** `UserPromptSubmit` and `PreToolUse` look similar but are not
interchangeable:

- **`UserPromptSubmit`** can inject non-blocking text into Claude's context via
  `hookSpecificOutput.additionalContext` — a "here is what you'll need" heads-up that
  never stops the prompt from being processed.
- **`PreToolUse`** has no `additionalContext` field — that channel does not exist at this
  event. The only way a `PreToolUse` hook hands Claude a message is
  `hookSpecificOutput.permissionDecision` (`"allow"` / `"deny"` / `"ask"`, plus `"defer"`
  in non-interactive `-p` mode only) with a `permissionDecisionReason` string, which is
  used **only when the decision is `"deny"`** — a denied call is cancelled and the reason
  is fed back to Claude so it can adjust and retry. Exit code 2 blocks the same way,
  reading the reason from `permissionDecisionReason` if valid JSON was written, or from
  stderr otherwise (see `.claude/hooks/pre-tool-safety.sh` for the exit-code form, and
  `.claude/hooks/pre-mr-security-gate.sh` for the JSON `permissionDecision: "deny"` form).

Before writing a hook's output block, check the current contract for that specific event
at the official Claude Code hooks reference rather than porting a shape from a hook on a
different event — this project's own `pre-mr-security-gate.sh` was rewired from
`UserPromptSubmit` to `PreToolUse` in #11 specifically because the two events' output
contracts are not interchangeable.

### Hook `if` field

Every hook entry accepts an optional `"if"` shell expression. The hook runs only when the expression exits 0. Use this to filter on specific tool inputs without writing a full shell script:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/pre-push-guard.sh\"",
          "if": "echo \"$CLAUDE_TOOL_INPUT\" | python3 -c \"import sys,json; d=json.load(sys.stdin); exit(0 if 'git push' in d.get('command','') else 1)\"",
          "timeout": 5
        }
      ]
    }
  ]
}
```

### Why no hook caps subagent fan-out (issue #54)

`settings.json`'s `deny` list guards the *outputs* of agent work (force-push, auto-merge,
reading secrets). It has no lever for the *shape* of the work itself — how many agents
one task spawns, or whether a delegated agent re-delegates. A `PreToolUse`/`SubagentStart`
hook that counts or blocks fan-out was considered and rejected, not skipped:

- **`SubagentStart`/`SubagentStop` cannot block.** They are metadata lifecycle events,
  not tool calls, and are not in the set of events exit-code-2 blocking applies to — so
  there is no hook point that can refuse a subagent spawn the way `pre-mr-security-gate.sh`
  refuses a `Bash` call.
- **Matching the spawn itself on `PreToolUse` is version-fragile.** Community reports
  describe a `matcher: "Task"` rule intercepting subagent spawns on some Claude Code
  versions, but the tool's name is undocumented and has changed across releases (`Task`
  vs. `Agent`) — a hook keyed to the wrong name fails **silently**, which is worse than no
  hook.
- **Whether hooks fire for tool calls made *by* a subagent is itself disputed.** The hooks
  reference states subagent tool calls carry `agent_id`/`agent_type` through the same
  configured hooks; a still-open upstream report says the opposite — that only the main
  thread's own tool calls fire them. Building a fan-out cap on a contract that isn't
  settled is exactly the "fabricate an enforcement that quietly does nothing" trap this
  section exists to avoid.

**What is enforceable today lives at the agent-definition layer, not `settings.json`:**
an agent whose `.claude/agents/<name>.md` frontmatter omits `Agent` from `tools:` cannot
spawn sub-agents at all — that's a real, load-bearing restriction, not prose (see
`accessibility`, `perf-check`, `rbac-check`, `ux-review`, `completeness-check`,
`schema-check`, `generated-artifact-check`, all deliberately tools-restricted this way).
The fan-out *ceiling* — wave size, no re-delegation, model choice — is enforced by
review discipline instead: see *Subagent fan-out ceiling* under *Agent workflow* below,
and verify what a delegated agent actually did (`git log`, the MR it opened) rather than
trusting its summary.

---

## Fast paths by change class — read this first

The agent workflow below describes the full chain for the heaviest case: a new
user-visible feature that touches API, UI, and data model at once. **Most changes
are smaller.** Apply this table *first*. If a change clearly fits one row, run only
the gates in that row — the unnamed gates are out of scope. Do not run the full
chain out of habit; proportional ceremony is the point.

| Change class | Required gates (in order) |
|---|---|
| Pure bugfix with identified root cause | `regression-check` → `test-scaffold` (if no coverage) → `completeness-check` → `changelog` → `/mr` |
| Dependency bump (single package, no API change) | `dependency` → `changelog` → `/mr` |
| Docs-only | `docs` (if a new page) → `completeness-check` → `/mr` |
| Chore / CI config / lint-only | `/mr` |
| Backend-only feature (new endpoint or model) | `architect` → pre-MR gate batch → `test-scaffold` → `completeness-check` → `changelog` → `/mr` |
| Wiring onto an already-designed surface (a form or toggle bound to an *existing* API contract, inside a shell whose design already shipped, no new interaction pattern) | `ux-review` (visual diff) → `rbac-check` + `security-review` + `regression-check` → `test-scaffold` → `completeness-check` → `changelog` → `/mr` |
| Frontend-only feature (no API change) | `architect` → `ux-design` → implement → `ux-review` + `accessibility` → `test-scaffold` → `completeness-check` → `changelog` → `/mr` |
| New user-visible feature (full stack) | `/voc` → `architect` → `ux-design` → implement → pre-MR gate batch → `ux-review` + `accessibility` → `test-scaffold` → `completeness-check` → `changelog` → `/mr` |
| New trust-boundary subsystem (auth, uploads, tenancy, external input) | `threat-model` → `architect` → implement → pre-MR gate batch (incl. `security-review` + `rbac-check`) → `test-scaffold` → `completeness-check` → `changelog` → `/mr` |

When a change spans rows, take the **union**. When a change is genuinely ambiguous,
default to the **heavier** row — but say which row you chose and why, so the user
can redirect. When a whole class of change keeps triggering a gate that finds
nothing, that is a signal to add a carve-out row here — see `/kaizen`.

---

## Pre-MR gate batch — run in parallel, not serially

The pre-MR gate cluster — `regression-check`, `security-review`, `rbac-check`,
`perf-check` — are **independent reads of the same diff**. None depends on another's
output. Run them as a **single parallel agent batch** (multiple Agent calls in one
message), then consolidate the findings before `/mr`. Serial invocation of these is
the single biggest avoidable source of pre-MR drag.

Apply only the gates relevant to the diff:
- `security-review` + `rbac-check` — only if a view, route, handler, endpoint, serializer, permission, or auth path changed
- `perf-check` — only if a query or data-access path changed
- `regression-check` — **always**, on any source-touching branch

**Then, before `git push`, run `completeness-check`** (`.claude/agents/completeness-check.md`)
— one fresh agent that did not write the branch, reading the issue (with comments), the
diff and the code. It is serial *after* the batch on purpose: it audits the branch the
batch's fixes produced. It exists because an upstream audit found gaps in 16 of 20 merged
MRs whose rules were already written down but that nobody but the author had applied
before the push. Fix every finding in a **new commit, never an amend**,
so the fix diff stays separable. Then at most **one** more pass, never a loop: a full
**round 2** (fresh Opus, not shown round 1's findings) when round 1 reported a
`class-missed` or `collateral` BLOCKER or four or more findings; otherwise a narrow
**fix-diff re-check** of the fix commits only, when round 1 returned a BLOCKER or a fix
commit changes executable behavior (application code, CI or chart logic, a gate or check
script, a migration — not docs, tests, comments, or changelog text). Record the re-check as
`gate: completeness-check/fix-diff — <N> findings` (`/fix-diff`, not parentheses: the
ledger parser drops a label with a space or paren), `n/a` when the fix round was docs,
tests, comments, or changelog only; record round 2 as a second `completeness-check` line with
`round 2` first in its parenthetical. See `.claude/agents/completeness-check.md`
§ After round 1. Its `## Requirements`
table goes in the MR description, and the `mr-followups` CI job fails any MR description
that names a follow-up without an open issue.

Any 🔴 Critical/High finding stops the MR: surface it and ask the user how to
proceed. 🟡/🟢 findings are summarized inline, then `/mr` continues.

---

## Agent workflow

The following agents are available and should be used proactively. Model assignments ensure the right reasoning level for each task: **opus** for synthesis, trade-off analysis, and judgment calls; **sonnet** for pattern scanning, checklist execution, and code generation.

### Subagent fan-out ceiling — a default, not a suggestion

Everything above guards the *outputs* of agent work. This is the guard on its *shape*.
Upstream, a wave of delegated agents cost ~122M tokens per merged MR — 95.9% cache reads,
3.9% cache creation, 0.2% output, so the bill is `turn count × context size × fan-out`,
not generation. Spend was concentrated, not uniform: the top 10 of 169 subagents were 44%
of the total, one at 166M against a 6M median. A single wandering agent costs more than
twenty focused ones. Defaults, for **any** multi-agent orchestration in this project —
not only `/batch`:

- **Cap concurrent delegated agents at 5 per task** (`/batch`'s default wave size).
  Past that, stop and ask, and say why the task needs more before spawning.
- **A delegated agent does not re-delegate.** One level of Phase-1 research delegation is
  fine for the opus agents that declare it in `.claude/agents/*.md` (`architect`,
  `dependency`, `docs`, `regression-check`, `security-review`, `test-scaffold`,
  `threat-model`, `ux-design`, `voc` — see *Agent file frontmatter reference* below); the
  sonnet sub-agents *they* launch must not themselves list `Agent` in `tools:`, so nesting
  never goes past one level (upstream: unbounded nesting produced a 2 → 16 fan-out on a
  task that needed neither).
- **Read-only gates run on Sonnet under `/batch`**. `/batch` passes `model: "sonnet"` when it spawns
  them, which overrides the `model: opus` frontmatter that `regression-check` and
  `security-review` carry for standalone use. They escalate to Opus only on `/batch`'s named
  criteria (root cause unknown, fix spans ≥3 packages, changes core domain semantics, or
  needs a design judgment the issue doesn't settle) — "this is important" and "this is a
  security fix" are not escalation criteria on their own.
- **Explicit override**: a deliberately large wave is `/batch`'s job — raise `WT_CAP` and
  state the new size and the reason in the report, rather than quietly spawning past the
  default.

This is prose discipline, enforced by review rather than a setting — see *Why no hook
caps subagent fan-out* above for why `settings.json` cannot enforce it directly today, and
*Step 6 — Verify before you believe it* in `.claude/skills/batch/SKILL.md` for how to
check what a delegated agent actually did instead of trusting its summary.

### Planning gate (once, before development on a new release)

- **`/dotplanning [version]`** — the begin-gate bookend to `/pre-release`. Run **once**
  at the kickoff of a new release milestone, before any feature branch exists: it
  resolves the milestone scope, builds a feature→asset map, flags every missing
  screen/flow/endpoint/model/doc, surfaces the decisions that must be answered before
  coding, sequences the work into gated workstreams, and drops a self-contained HTML
  report. Development then follows the plan, one workstream at a time, through the
  fast-paths chain below. Do not re-run per feature.

### Feature design sequence (mandatory for new features and UX changes)

For any new user-facing feature or UX change, follow this sequence in order:

1. **`voc`** (opus) — Voice of the Customer panel. Run first to surface adoption blockers and persona tensions before any technical design.
2. **`threat-model`** (opus) — *only if the feature crosses a trust boundary* (auth, uploads, tenancy, external input). Reasons about data flow and trust boundaries before code exists; feeds the architect's ADR.
3. **`architect`** (opus) — Technical architecture review. Include the VoC panel summary (and threat model, if run) so design decisions are informed by user priorities and security constraints.
4. **`ux-design`** (opus) — UI/UX design proposal. Include the architect review so the design aligns with the approved technical approach.
5. Implement the feature.
6. **`ux-review`** (sonnet) + **`accessibility`** (sonnet) — design-system compliance and WCAG 2.1 AA conformance, after implementation.

Do not skip the VoC step for user-facing work. If a feature has no UI component, skip steps 4 and 6 but still run VoC and architect.

### During implementation
- **`test-scaffold`** (sonnet) — when test coverage doesn't exist for affected code
- **`security-review`** (opus) — when modifying endpoints, auth logic, or input handling
- **`rbac-check`** (sonnet) — when adding or modifying any endpoint, view, or permission rule; a missing permission check is a vulnerability, not a nit
- **`perf-check`** (sonnet) — when modifying queries or data access patterns
- **`dependency`** (sonnet) — before adding any new package

### Before creating an issue
- Search the tracker for duplicates and partial overlaps in open and recently closed issues (`glab issue list --search "<key terms>" --all`) before filing a new one; `/tracker-hygiene` sweeps for them after the fact

### Before merging
- Run the **pre-MR gate batch** (`regression-check`, `security-review`, `rbac-check`, `perf-check`) as one parallel agent batch — see the *Pre-MR gate batch* section above. Apply only the gates relevant to the diff.
- **`completeness-check`** (sonnet; opus when `batch`'s escalation criteria apply) — after the gate batch, before `git push`: a fresh agent audits the branch against its issue
- **`changelog`** (sonnet) — creates fragment file for the CI changelog-check job
- **`docs`** (sonnet) — when writing or updating documentation

### Harness self-improvement
- **`/kaizen`** — periodically audit the *development process itself* (CI, gate chain, pre-push, MR flow) for friction and propose a small, ranked list of speed wins. Distinct from `/pre-release` (which audits the code): kaizen audits the harness. When a gate keeps firing on a change class and finding nothing, kaizen is where that carve-out gets proposed for the fast-paths table.

### Pre-release gate

Run `/pre-release full` at feature freeze and again before cutting a release tag. This is a **one-time gate check**, not an iterative fix-verify loop:

1. Run `/pre-release full` → produces a report with 🔴 🟡 🟢 findings
2. Fix all 🔴 blockers in separate commits
3. Triage 🟡 findings: fix now or create milestone issues
4. Only re-run `/pre-release full` if the fixes were substantial enough to warrant a full re-audit
5. Proceed to `/release` once blockers are resolved

### Skills (user-invocable)
- **`/kickoff`** — interactive project setup from this template (name, personas, first milestone) ⛔
- **`/import-spec`** — convert a PRD/spec/feature list into structured tracker issues ⛔
- **`/import-design`** — convert a design guide into `frontend/CLAUDE.md` for the UX agents
- **`/dotplanning`** — plan a release milestone before development starts (feature→asset map, gaps, sequenced plan, HTML report) ⛔
- **`/mr`** — open a merge request (includes pre-flight checks and test verification) ⛔
- **`/fix-mr`** — get a blocked MR to green AND mergeable: pipeline failures and conflicts with the default branch (up to 3 iterations) ⛔
- **`/mass-merge`** — land a batch of already-green MRs without reddening the default branch ⛔
- **`/batch`** — land a wave of milestone issues in parallel, one worktree and one delegated agent per issue ⛔
- **`/review`** — code review against project conventions for a file or branch diff
- **`/adr`** — create an Architecture Decision Record with sequential numbering
- **`/ci-debug`** — diagnose a failing CI pipeline
- **`/kaizen`** — audit the development harness for friction and propose ranked speed wins
- **`/incident-postmortem`** — postmortem one resolved harness/process incident; writes the lesson to the memory store
- **`/tracker-hygiene`** — sweep the tracker for label, duplicate, and staleness drift between kickoffs
- **`/release`** — create a release (version suggestion, pre-flight, changelog rotation) ⛔
- **`/pre-release`** — cross-cutting audit (security, perf, regression, docs) before a release
- **`/voc`** — Voice of the Customer panel (also available as an agent for proactive invocation)
- **`/voc-audit`** — VoC panel against a shipped surface, findings verified against the code ⛔
- **`/sunset-check`** — decide whether an existing surface should be removed, fixed, narrowed, or demoted
- **`/memory-audit`** — sweep the Claude Code memory store for what makes it unrecallable ⛔

⛔ = `disable-model-invocation: true` — user-only, not auto-invoked by Claude

### Model assignment rationale

The `model:` in an agent's frontmatter is its default for standalone use. `/batch` overrides
it at spawn time by passing `model: "sonnet"` on the Agent call, so the opus row below does
not apply to `regression-check` and `security-review` inside a `/batch` wave.

| Model | Used for | Why |
|---|---|---|
| **opus** | architect, threat-model, security-review, ux-design, regression-check, voc | Cross-file reasoning, trade-off analysis, persona empathy, attack scenario modeling |
| **sonnet** | changelog, completeness-check (opus when `batch`'s escalation criteria apply), dependency, docs, perf-check, rbac-check, test-scaffold, ux-review, accessibility | Pattern matching, checklist execution, structured code generation |

Opus agents that delegate Phase 1 research use sonnet sub-agents for the mechanical scanning, then do the synthesis themselves. This balances cost and quality.

### Agent file frontmatter reference

Each file in `.claude/agents/` uses YAML frontmatter to configure the agent:

```yaml
---
name: my-agent           # matches the agent name used in code
model: opus              # opus | sonnet | haiku — pick based on task complexity
description: >           # when Claude should use this agent (shown in agent picker)
  Use when X. Do not use when Y.
tools:                   # restrict to only the tools this agent needs
  - Read
  - Grep
  - Glob
  - Bash
disableMcpServers: true  # optional: isolate from MCP servers for security-sensitive agents
---
```

Keep `tools:` minimal — an agent that only reads should not have `Write` or `Bash`.
Use `disableMcpServers: true` for agents that handle sensitive code or credentials.

<!-- CUSTOMIZE: Add project-specific agents below. Examples: -->
<!-- - **`broadcast-check`** (sonnet) — when adding write operations on real-time resources -->
<!-- - **`enterprise-check`** (opus) — when classifying a feature as open-core vs enterprise -->
<!-- - **`ai-review`** (sonnet) — when a feature must be reachable by an MCP/agent client -->

Schema and generated-contract changes are **not** examples — `schema-check` and
`generated-artifact-check` ship with the blueprint. Both classes cost production
incidents in every stack that has them, so neither is left to be rediscovered.

---

## Backward compatibility — always on from [X.Y]

<!--
CUSTOMIZE: Set [X.Y] to your API stability version. Remove this entire section
if you haven't reached a public API contract yet.
-->

[PROJECT NAME] [X.Y] is a public API contract. Every change must be backward compatible unless a major version bump is explicitly planned.

### REST API
- **Never remove or rename a field** from an existing response — add new fields, deprecate old ones, never delete them in a patch or minor release
- **Never change a field's type** (e.g. string → integer, nullable → required) without a major bump
- **Never remove an endpoint** — return `410 Gone` with a deprecation notice for at least one minor release first
- **New optional params only** — never add a required query param to an existing endpoint; new body fields must be optional with a sensible default

### Database migrations
- **Every new column must be nullable or have a default** — `NOT NULL` without a default requires a multi-step deploy and blocks zero-downtime upgrades
- **Never drop a column or table** in the same migration that removes the ORM reference — separate by at least one release cycle
- **Rename = add + copy + drop** across three separate releases

### Settings and env vars
- **Never rename an env var** — add the new name and keep the old as a deprecated alias for at least one minor release
- **Never change the default value** of an existing env var in a way that alters behavior for existing installs

<!-- [REMOVE IF NOT APPLICABLE] WebSocket event schema -->
<!--
### WebSocket / real-time event schema
- **Never remove an event type** — add new ones freely; mark old ones deprecated for at least one release
- **Never remove a field from an event payload** — add fields freely; removals require a major bump
- Keep a stable `{event, data}` envelope shape — never flatten back to a spread payload
-->

<!-- [REMOVE IF NOT APPLICABLE] TypeScript interface rules -->
<!--
### TypeScript / frontend contracts
- Shared interfaces must match backend serializer fields exactly — update both in the same MR when adding a field
- Never remove a field from a shared interface without confirming it is unreferenced across the entire frontend
-->

---

<!-- [REMOVE IF NOT APPLICABLE] Open core / enterprise boundary -->
<!--
## Open core vs. enterprise boundary

[PROJECT NAME] follows an open-core model. A small team must be able to use the product end-to-end without the enterprise edition.

Ask: **"Can a small team work together effectively without this feature?"**
- No → OSS core
- Yes → enterprise candidate

Enterprise candidates: SSO/SAML, audit logs, advanced analytics, automation rules, multi-tenancy, white-labeling, compliance tooling.

Rules:
- Never add enterprise code to the OSS repo
- OSS must expose clean extension points that enterprise plugs into without modifying OSS files
-->

<!-- [REMOVE IF NOT APPLICABLE] Frontend design system link -->
<!--
## Frontend UI conventions
See [`frontend/CLAUDE.md`](frontend/CLAUDE.md) for design system rules — color tokens, buttons, inputs, modals, typography, and component patterns.
-->
