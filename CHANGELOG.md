# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.7.0] — 2026-10-05

### Added
- **Diagrams for visual learners.** A new **Flows** guide draws each lifecycle flow as a [Mermaid.js](https://mermaid.js.org/) diagram that reads top to bottom: project and issue creation, a new milestone, early-stage batch work, `/batch` for a single issue, the road to `/release`, and the feature design sequence. An "anatomy of a command" box diagram covers `/batch`, `/mass-merge`, `/release`, `/dotplanning`, and `/mr`. The full chain in the development-workflow guide is now a Mermaid diagram too. Diagrams render client-side (`astro-mermaid` and `mermaid` added to the docs site) (#72, #83).
- **Feedback is encouraged and welcome.** A new **Feedback** issue template labels issues `feedback` and `external`. A new **Giving feedback** guide walks you through filing one on GitLab. Tell us what worked, what confused you, and what is missing, using the [Feedback form](https://gitlab.com/macrodream/blueprint/-/issues/new?issuable_template=Feedback) (#84, #70).
- New guides: **Testing AI-written code** (fuzz and mutation testing, and why coverage alone is not proof when an AI writes both the code and the tests) (#77). **External validation** (SonarQube Cloud, the scanner stack, OpenSSF Scorecard) (#78). **Publishing to GitHub** (mirroring a public GitLab project, labeling the mirror read-only, and a readiness checklist) (#79).
- `scripts/release.sh` now shows the extracted release notes and requires approval before committing. Enter accepts, and anything else aborts and removes the release branch. Empty notes and non-TTY runs without `--yes` or `RELEASE_ASSUME_YES=1` fail closed. `/release` gains a chat-approval step (#68).

### Changed
- **The docs site is rewritten in [Axios Smart Brevity](https://www.axios.com/smart-brevity) style to cut cognitive load.** Every page opens with the big picture and why it matters, so you can stop after the first screen, and the full detail sits below for when you need it. New **Agents** and **Glossary** pages. The **Skills** page now explains what each of the 20 skills does, why it matters, and when to use it. Also fixes drift: the file tree, CI job list, and docs-site page now match the repository (#70).
- `/batch` now runs `completeness-check` before every push. Implementers commit and stop, and the orchestrator runs the fresh-agent audit. Fixes land as a new commit, and a stale-base check precedes the push. The audit gains cause tags, a narrow `completeness-check/fix-diff` re-check, a conditional round-2 audit, and a clean-branch precondition. `/kaizen`'s ledger parser now handles `/<mode>` gate labels. Ten agents gain class-level checks (#69).
- `/batch` docs now explain model selection (Sonnet by default, Opus for four named reasons) and how to keep token use down. `regression-check` and `security-review` keep `model: opus` standalone, and `/batch` overrides them to Sonnet (#75, #76).
- `/mass-merge` now checks up front that the session may run `glab mr merge`. Without that permission it only reports conflicts and lands nothing (#74).
- The README and docs landing page show that Blueprint is the harness behind Visiban and TruePPM, with each project's repo and docs. The README no longer repeats the pipeline and MR counts (#73).

### Fixed
- `scripts/wt new` and the new `wt claim` check an issue out with a `status::wip` label and comment, and refuse one another session holds (`--force` takes over). `wt remove`, `wt prune`, and the new `wt release` clear it, and `/batch` skips labeled issues. **Behavior change:** `wt new` now refuses an issue you labeled by hand (#82).
- A release run that fails before the release commit now removes its branch and returns to `main` with a clean tree (#71).

### Security
- Bumped the docs site's transitive `http-cache-semantics` from 4.2.0 to 4.3.0 to clear GHSA-ch52-4w7c-c8xp (HIGH, CVSS 8.7), which was failing `osv-scan`.

## [0.6.0] — 2026-09-27


### Added
- CI now exercises the onboarding path end-to-end: `onboarding-customize-e2e`
  builds a scratch clone, simulates a completed `/kickoff`, and asserts
  `scripts/customize.sh` reports the project fully configured (no leftover
  template placeholder) while `scripts/doctor.sh` still runs to completion
  against that same tree (#53)
- A documented default ceiling on subagent fan-out: cap concurrent delegated agents at
  5 per task (`/batch`'s wave size), no re-delegation beyond one Phase-1 research level,
  read-only gates default to the cheaper model, and an explicit override path for a
  deliberately larger wave. Lives in `CLAUDE.md`'s *Agent workflow* section,
  `global-claude-md.example`, and `reference/agent-architecture.md`'s new *Fan-out
  ceiling* section. A `settings.json`/hook enforcement mechanism was researched and
  rejected as not robust — `SubagentStart`/`SubagentStop` can't block, and the
  subagent-spawning tool name isn't stable across Claude Code versions — documented
  inline so nobody re-discovers the same dead end (#54).
- A `completeness-check` agent: before `git push`, and after the pre-MR gate batch, a
  fresh agent that did not write the branch audits it against its issue (acceptance
  criteria, test-plan lines, comments), the whole bug class, consumers of any shared
  rule it changed, and whether its tests and docs prove it. It produces the new
  `## Requirements` table in `/mr` descriptions. `regression-check` now sweeps the
  consumers of a changed shared rule, and `test-scaffold` requires a negative control
  that never uses `git stash` (#57).
- An `mr-followups` CI job (`scripts/check-mr-followups.sh`) that fails an MR whose
  description says follow-up, deferred, left open or out of scope without naming an
  open issue on the same line. A `followup-ok` marker opts a line out (#58).
- `/release` now inventories the tag-only CI jobs changed since the last tag (which
  run for the first time at the tag) and notes the time since the last tag.
  `scripts/release.sh` refuses a version already tagged on the remote or reported
  published by an optional `RELEASE_PUBLISHED_CHECK`, failing closed when the remote is
  unreachable. A new `artifact-assertions` CI job and `scripts/ci-assert-artifacts.sh`
  make a tag-triggered job fail when a declared `artifacts:paths` entry is empty,
  instead of GitLab passing it (#62).
- `scripts/check-tag-only-jobs.sh` makes `/release`'s tag-only job inventory mechanical
  and self-tested, instead of an agent reading a raw `git diff` on judgment alone: it
  reports any job whose rules match `$CI_COMMIT_TAG` (or `only: tags`) and whose block
  text is new or changed since the last `v*` tag, so it has never run in its current
  form. Wired into `tooling-self-tests` alongside `scripts/release.sh --self-test` (#67).

### Changed
- `/pre-release` now states its agent count and a token estimate before launching, and
  forbids nested fan-out: every agent prompt it sends says not to spawn subagents (#59).
- The `docs` agent and `/pre-release`'s documentation phase now state which claim classes
  a docs pass verifies and which it does not (feature existence, edition truth, command
  execution), and never report "docs reviewed" (#60).
- The `docs` agent's drift sweep now covers `README.md` and `changelog.d/` when a plan or
  fact moves, not just the docs site (#61).
- `global-claude-md.example` replaces its ten per-gate sections with one *Gate
  reference* table that records only what each gate's own description does not, adds a
  *Testing practice — always on* section, adds a fast-path row for wiring a form onto an
  already-designed surface, and replaces the reference to a `duplicate-check` agent that
  never existed with a direct tracker search (#63).

### Fixed
- The application-aware gates now run in CI (job `app-fixture-gates`) against a
  realistic application fixture that `scripts/tests/app-fixture-gates.test.sh`
  generates into a temp directory at test time, instead of only against
  Blueprint's own tree, where each skipped. The fixture is never committed, so it
  does not ship into projects cloned from Blueprint. The first run fixed three
  bugs: `check-serializer-ts-parity.py` crashed with exit 1 on drf-spectacular's
  `NullEnum` for any `null=True` choice field and ignored inherited fields on
  `interface X extends Y`; `check-migration-numbering.sh` reported every
  `squashmigrations` output as a collision. `check-ws-event-reachability.py`'s
  default broadcast pattern now sees a multi-argument group helper such as
  `group_name("program", program.id)` (#52).
- Retired the `release-tag` / `release-publish` CI automation and its
  `RELEASE_TOKEN` CI/CD variable. `release-tag`'s rule matched
  `$CI_COMMIT_MESSAGE` against `/^chore: release v/`, but GitLab CI rule
  regexes use RE2, where `^` is a string anchor, not a line anchor — a real
  GitLab merge commit's message puts the MR title on the second line, so the
  rule never matched and the job never ran (confirmed on the v0.5.0 cut). Tagging
  and publishing a release are now the documented manual step run right after
  the release MR merges (`git tag` + `glab release create` — see
  `.claude/skills/release/SKILL.md` Step 5 and the release-workflow guide),
  needing no extra CI credential (#56).
- `make gate-self-tests` no longer fails with "No such file or directory": it still
  ran `scripts/publish-release.sh --self-test` after #56 deleted that script, and the
  dead `publish-release-selftest` target is gone (#62).
- `.envrc` and `.wt-owner`, which `scripts/wt new` writes into every worktree, are
  now gitignored; `git add -A` in a worktree used to commit them (#64).
- The shipped `.claude/settings.json` no longer carries schema-invalid keys:
  `defaultShell: "/bin/bash"` (only `"bash"` / `"powershell"` are valid),
  `sandbox: false` (must be an object), and `enabledPlugins` /
  `extraKnownMarketplaces` as `[]` (both are objects). Claude Code ignored each
  with a warning on every session start. The keys are now omitted so the defaults
  apply, and the settings reference in `CLAUDE.md` shows the correct shapes.
## [0.5.0] — 2026-09-22


### Added
- A full documentation site (`website/`, Astro Starlight, published to GitLab Pages by
  the new `website:build` / `pages` CI jobs) replaces the reference material that made
  `README.md` 1,567 lines long. `README.md` is now a landing page — what Blueprint is,
  who it's for, what it does not do, and pointers to the quickstart and full docs — under
  200 lines.
- The landing page and a new 15-minute quickstart state Blueprint's prerequisites, an
  explicit "what Blueprint does NOT do" list, a "who is this for" fit table, and the
  adoption ladder (you don't need Blueprint to start exploring or building reliably) —
  positioning gaps identified by an external review of the project's discoverability.
- Documented the multi-terminal workflow in the parallel-work guide: running six to
  eight Claude Code panes per editor window, the distinct roles they play (parallel
  execution, research/triage, "actioned but not forgotten"), and the `/compact` and
  `/clear` discipline that keeps that many concurrent sessions cheap to run.
- Staged the new `shellcheck` gate at `--severity=warning` rather than shellcheck's
  default, after CI (Alpine 3.19's `shellcheck` 0.9.0) flagged two pre-existing
  `SC2015` (info-severity) findings that a newer local shellcheck didn't reproduce.
  Tracked as #27 to promote once those two are cleaned up.
- Added `check-load-bearing.sh` and the `load-bearing.declarations` manifest: a
  project declares the call sites that wire in a guard, hook, filter, or validator
  where exactly one line does the wiring, and the gate fails when such a line
  disappears. This is the one failure class nothing else in the harness reports —
  delete the single `installSchemaGuard(page)`-shaped call and the guard stops
  guarding while every test stays green. A declaration names a repo-relative
  `path:`, the literal `call:` that must still appear in it, and a required `why:`.
  Runs in its own CI job (`load-bearing`, self-test first) and in
  `make pre-push-checks`; `--list` resolves every declaration to a line number
  without judging. Ships with seven declarations covering Blueprint's own
  single-line wirings — the pre-push and pre-commit hook invocations, both Claude
  Code hook entries in `.claude/settings.json`, and the three `is_ignored` /
  `drop_ignored_lines` guards inside gate tree-walks (#29).
- Internal documentation link/anchor/asset checker (`scripts/check-docs-internal-links.py`,
  ported from TruePPM), wired into a new `ci/docs.yml` template that self-gates on the
  project having a docs site — a broken internal link, anchor, relative asset, or
  cross-repository source link under `website/src/content/docs` now fails the pipeline
  instead of shipping silently (#32)
- `/kaizen` now reads a declined-findings ledger (`.claude/kaizen-declined.json`) before
  ranking or reporting, so a finding a human has already reviewed and declined stops
  being re-proposed on every subsequent run. Declining is a recorded action — a stable
  id, a date, and the human's own reason — not a silent omission, and the skill documents
  two ways to un-decline: ask `/kaizen` to remove an entry, or edit the git-tracked JSON
  file directly. A decline also expires on its own once the underlying finding's claim
  changes shape (e.g. a gate moves from a fast-path candidate to load-bearing).
- Added two optional `ci/python.yml` jobs, ported and genericized from
  upstream Visiban originals: `python-schema-fuzz` fuzzes a live API against
  its own declared OpenAPI schema with schemathesis and fails on a
  schema/response mismatch, and `python-nightly-load-test` measures p50/p95/p99
  latency for a configurable list of endpoints (`nightly-load-test-budgets.json`)
  and fails when a scheduled run exceeds its committed p95 budget. Both are
  inert until a clone wires up the API-boot hook script each one names — see
  `ci/python.yml`'s own header comments and the "Python: schema fuzz and
  nightly load test" section of the CI pipeline guide.
- `ci/sonar-complexity.yml` — cognitive-complexity tier for Python script
  entry points, **off by default** (uncomment the include to opt in):
  - `scripts/check-cognitive-complexity.py` scores each module-level function
    against a local, offline approximation of SonarSource's Cognitive
    Complexity metric (rule S3776) — no SonarCloud/SonarQube account, token,
    or network call required.
  - The threshold (15) is derived from this repo's own `scripts/*.py`, not
    copied from Sonar's default — see the script's `DEFAULT_THRESHOLD`
    comment for the measurement, and re-derive it with `--list` against your
    own tree before relying on it.
  - Verified false positives (legitimately branchy dispatch/resolvers) are
    suppressed with a reasoned `# cognitive-complexity-ok: <reason>` marker
    on the `def` line; a bare marker with no reason is still an offender.
  - `ci/CLAUDE.md` documents what a finding does and does not tell you —
    not a defect count, not SonarCloud's own verdict, and blind to shell
    entry points, class methods, and nested defs/lambdas.
  - Along the way, reduced real cognitive-complexity findings in this
    repo's own `scripts/`: extracted `_classify_reference` out of
    `adr-accepted-issue-sweep.py`'s `classify` (28 → 14) and
    `_print_scope_notes`/`_print_verdict` out of
    `check-docs-internal-links.py`'s `run_check` (19 → 11), both verified
    self-test- and output-identical.
- Added `check-compose-project-names.sh`: fails when a standalone Docker Compose
  file has no pinned top-level `name:` (the unpinned default derives from the
  checkout directory, which collides silently across stacks or worktrees) or
  when an auto-merged `*.override.yml` file declares one. Lives in
  `ci/docker.yml` — a project without Docker never runs it — and is mirrored in
  `make pre-push-checks`, where it passes with nothing scanned if no compose
  file exists (#42).
- Added `check-nul-bytes.sh`: fails a push or MR when a tracked file git resolves
  to `text: set` contains a literal 0x00 byte, which makes git treat the whole
  file as binary and silently defeats every grep-based gate that walks the tree.
  Runs in its own CI job (`nul-bytes`) and `make pre-push-checks` (#42).
- `ci/helm.yml` — Helm chart CI hardening, opt-in and gated on a chart
  actually existing (`$HELM_CHART_DIR/Chart.yaml`):
  - `scripts/check-chart-registry.sh` catches a plain `X.Y.Z` OCI chart
    permanently shadowing its own `X.Y.Z-beta.N` releases — drift that no
    commit introduces and no MR pipeline can see, since the registry is the
    only place it happens. Runs on a schedule; degrades to a no-op when no
    chart registry is configured (the default for a fresh clone) and fails
    closed (not silently) when one is configured but unreadable.
  - The install drill gained an upgrade leg (`DRILL_LEG=upgrade`): installs
    the previously released chart from the OCI registry, then `helm upgrade`s
    it to HEAD — exercising the path every real operator actually walks,
    which a from-empty install never touches.
  - Both drill jobs retry `kind create cluster` (bounded, 3 attempts) —
    cluster creation is the flakiest step in a drill job.
- Four contract & collision drift gates, ported and genericized from two
  prior application repos (Visiban, TruePPM) that had each independently
  built a version of one of them — consolidated from #34, #35, #36, #39:
  - `scripts/check-migration-numbering.sh` — a migration-number collision
    that exists only on the MERGED tree (two branches each claim the same
    next number in an app's migrations directory; each is green in
    isolation). Runs on every MR pipeline, so it fires on a rebase, not
    only at merge. Framework-agnostic — matches any `.../migrations/NNNN_*`
    file, not just Django's layout.
  - `scripts/check-ws-event-reachability.py` — a published real-time event
    taxonomy advertising an event no client can actually subscribe to (no
    route/consumer exists yet that can join its channel). Checks both
    directions: unmarked-and-unreachable fails, and a stale "not
    deliverable" marker left in place after the route ships also fails.
  - `scripts/check-added-files-covered.mjs` — a brand-new, entirely
    untested source file that never appears in a diff-coverage report at
    all, and therefore reads as 100% covered instead of 0%. Generalized
    into configurable "layers" (directory + extensions + coverage report +
    omit config); ships with Python-backend and TypeScript-frontend
    defaults, both safe no-ops when that directory doesn't exist.
  - `scripts/check-serializer-ts-parity.py` — drift between a
    hand-maintained shared TypeScript types file and what the backend API
    actually returns (an added/renamed field, a mismatched type, a
    nullability or enum disagreement), compared against a generated
    OpenAPI document rather than backend source, so it works with any
    framework that emits one.
  All four carry a `--self-test` that proves they can still fail, run
  self-test-first in their own CI job (`ci/python.yml` /
  `ci/node.yml`), have a `make pre-push-checks` mirror, and skip cleanly
  (exit 0) in a clone that has none of the stack they need — no
  migrations directory, no real-time taxonomy doc, no coverage report,
  no OpenAPI schema.
- Automate the tag + GitLab release publish step after a release MR merges
  (#5). `scripts/publish-release.sh`, run as two new CI jobs — `release-tag`
  (main branch, on a `chore: release vX.Y.Z` commit) and `release-publish`
  (the tag pipeline it starts, gated on `release-pipeline-gate`) — creates and
  pushes the version tag and publishes the GitLab release from
  `docs/releases/vX.Y.Z.md`, named to match the `v0.3.0`/`v0.4.0` precedent.
  Both jobs are idempotent and need a `RELEASE_TOKEN` CI/CD variable (masked,
  protected; scopes `api` + `write_repository`) — see
  [Release workflow](/guides/release-workflow/). `scripts/release.sh` no
  longer prints the tag/publish commands as a manual step.
- Added a "Deployment options" guide explaining when to reach for Kubernetes/Helm,
  Docker Compose, or something simpler than either, cross-linked from the CI pipeline
  guide and What's included.
- `check-version-lockstep.py` fails an MR when a version-bearing manifest disagrees
  with the others, or sits behind the last released changelog section. A manifest
  missing from a release script's bump list ships stamped wrong, and one that
  *derives* a default from its version — a Helm `appVersion` becoming an image tag —
  points that default at an artifact nobody built.
- `check-release-pipeline.sh` refuses a tag-triggered publish unless the commit's own
  branch pipeline reached success. A tag pipeline is not the branch pipeline running
  again: every job gated on a branch or merge request does not exist in it, and
  nothing links the two, so a red commit publishes happily.
- `/incident-postmortem` — postmortem one resolved harness or process incident, with
  the durable memory entry as the deliverable rather than the write-up. The reactive
  bookend to `/kaizen`.
- `/tracker-hygiene` — the between-kickoff sweep for scoped-label violations, issues
  in a dated milestone with no commitment value, likely duplicates, and stale
  unmilestoned intent. Reports only; it never relabels anything.
- `scripts/check-sigpipe-readers.sh` (`make check-sigpipe`, CI job
  `sigpipe-readers`) — no shell script may put an early-exit reader (`grep -q`,
  `grep -m`, `head`) on the far side of a pipe. It **walks** every shell file
  under `scripts/`, `hooks/` and `.claude/hooks/` — `.sh` extension or a sh/bash
  shebang, git-ignored files skipped — rather than checking a hand-listed set,
  because a list only ever covers the files that have already been bitten. A
  provably bounded site may carry an inline `# sigpipe-ok: <reason>` marker; the
  reason is required, so a bare marker is still an offender. Refuses to report a
  pass when a root holds no shell or has been renamed away.

### Changed
- Rewired the pre-MR security gate hook from `UserPromptSubmit` (fired on every
  prompt in every session, and only ever matched the literal string `/mr`) to
  `PreToolUse` with a `Bash` matcher, which detects a real `glab mr create`
  invocation instead. This closes the gap where an agent reproducing
  `glab mr create` directly — the path CLAUDE.md sends every agent down, since
  `/mr` is `disable-model-invocation: true` — never tripped the gate at all.
  The hook now blocks the `glab mr create` call itself
  (`permissionDecision: "deny"`) until the required gates run, since
  `PreToolUse` has no non-blocking context-injection channel. The bypass moved
  from a "skip security gate" phrase in the prompt to a `SKIP_SECURITY_GATE=1`
  shell env-var prefix on the command itself, matched only as a real
  assignment immediately before `glab` — never as a substring anywhere else in
  the command, including inside a `--description` heredoc body. Also stopped
  wiring `on-stop.sh` (24 lines of commented-out examples that cost a
  subprocess per response to do nothing) into `.claude/settings.json` by
  default; it stays in the tree as a documented example a project opts into.
- Split `dotplanning` and `mass-merge` — the two largest skills — into
  `SKILL.md` plus bundled reference files, the progressive-disclosure layout
  Anthropic's skill-authoring guidance recommends. Neither skill's own
  content changed; each file the model needs on every invocation stayed in
  `SKILL.md`, and reference material consulted at one step, or only when
  something goes wrong, moved out:
  - `dotplanning/kickoff-questions.md` — the twelve kickoff questions,
    grouped into their three `AskUserQuestion` calls (read at Step 2).
  - `dotplanning/html-output-spec.md` — the HTML report's required
    sections, severity palette, and CSS guidance (read at Step 8).
  - `mass-merge/failure-modes.md` — the merge-train failure modes and
    their recovery steps as a lookup table, consulted when one fires
    (competing-session takeover, the Phase A/Phase B gap, the
    `--force-with-lease` ref:sha footgun, and the Phase B non-negotiables).
  `dotplanning/SKILL.md` went from 472 to 405 lines; `mass-merge/SKILL.md`
  went from 420 to 396 lines. Both keep `disable-model-invocation: true`.
  `sunset-check`, `batch`, and `tracker-hygiene` — also named in #15 as
  candidates — are untouched; the issue judged them not worth splitting yet.
- Changed the docs site and README to point at the branded domain
  `docs.blueprint.macrodream.co` instead of GitLab's auto-generated Pages URL. The
  domain still needs registering under Settings → Pages (with its DNS records) before
  it resolves — noted at the point the URL is set in `website/astro.config.mjs`.
- `/dotplanning` asks twelve kickoff questions before it maps anything (charter,
  date-versus-scope, capacity, reserve, maturity, freeze, carry-over, cut line), and
  ends with a grooming pass that proposes a `release::` value for every milestone
  issue, fits the committed set to the stated capacity, and confirms by group before
  writing a single label.
- `/release` gates the tag on the commit's own branch pipeline, guards against a
  double bump when manifests were already bumped by a prep commit, and verifies what
  a default install *resolves to* rather than that the publish job succeeded — a
  stable version outranks its own pre-releases in a registry permanently.
- The `schema-check` agent no longer accepts "we only run one replica" as an argument
  for a single-release destructive drop without reading the deployment manifests: a
  rolling update surges a new pod at any replica count, so old and new run together
  regardless.
- The `accessibility` agent gains four ARIA invariants: a container holding real
  controls may not take a widget role, `aria-label` on a roleless element is
  prohibited outright, roles with required children are usually broken by markup that
  grew up around them (including DOM a wrapper library injects), and a library's own
  focusable overlay survives an `aria-hidden` ancestor.
- Widened `.claude/settings.json`'s Bash allowlist to Blueprint's actual read-only
  workflow (`glab issue view`, `git show`, `make gate-self-tests`, `make
  pre-push-checks`, `scripts/wt list`, `shellcheck`), and added
  `.claude/settings.local.json` to `.gitignore` — it was committable.

### Fixed
- Fixed `hooks/pre-commit` and `hooks/pre-push` blocking every commit on Linux (dash,
  BusyBox). Both used the bashism `&>`, which under a POSIX `/bin/sh` always evaluates
  true regardless of whether the guarded `make` target exists — with no `format-check`
  target defined, this made every commit fail on non-macOS shells. Added a `shellcheck`
  gate (`make shellcheck`, wired into `make pre-push-checks` and CI) so this class is
  caught going forward.
- Fixed the docs site 404ing on every link, stylesheet, and the search index. It was
  configured for a GitLab Pages URL of the form `<namespace>.gitlab.io/<project>/`, but
  this project has GitLab's unique-domain Pages setting on, so the real site is served at
  its own generated domain with no path prefix.
- Fixed the two pre-existing `SC2015` findings in `scripts/customize.sh` and
  `scripts/release-notes.sh` (rewritten as explicit `if`/`then`) and promoted
  `check-shellcheck.sh` from `--severity=warning` to shellcheck's default
  severity, now that a full-repo scan at default severity is clean (#27)
- Fixed `scripts/publish-release.sh` shellcheck findings (`SC2015`,
  `SC2030`/`SC2031`, `SC2317`/`SC2329`) that shipped with #5 before
  `check-shellcheck.sh` was promoted to default severity by #27 — the two
  branches were each green against the base they were tested on, but the
  combination failed `main`'s pipeline once both landed. The `SC2015`
  instances were genuine if/then/else, rewritten explicitly; the subshell
  env-var isolation and indirect-call dispatch flagged by the rest are
  deliberate self-test patterns, now suppressed inline with a reason (#47)
- Fixed `scripts/check-issue-collision.sh` running under a multibyte-aware
  locale (`en_US.UTF-8`) on a payload containing a multi-KB MR description:
  the whitespace-only check used a bash `${payload//[[:space:]]/}` global
  substitution, which is quadratic in payload size and further multiplied by
  locale-aware character decoding — measured 85.78s under `en_US.UTF-8` vs
  8.75s under `LC_ALL=C` on an ~11KB payload, growing worse as more or larger
  MRs stay open. Replaced with a single linear `tr -d '[:space:]'` pass, which
  measured 0.078s regardless of locale on the same payload — a structural fix
  rather than a locale pin, since the bash substitution's quadratic cost would
  still have grown unbounded with a larger paginated MR list even under
  `LC_ALL=C`. The gate's block/warn/pass decision is unchanged (#48)
- Fixed `scripts/setup-hooks.sh` (`make setup` / `make install-hooks`) failing with
  `ERROR: .git/hooks/ not found` from inside a `scripts/wt` worktree. It assumed
  `.git/hooks` was a literal directory path, which only holds in the main checkout —
  inside a worktree `.git` is a file pointing at the shared git dir. It now resolves
  the real hooks directory with `git rev-parse --git-common-dir` (new
  `scripts/lib/git-hooks-dir.sh`, also used by `scripts/doctor.sh` and
  `scripts/customize.sh`, which had the same literal-path assumption) and installs
  into that shared directory, so one `make setup` — from any worktree or the main
  checkout — covers all of them.
- The duplicate-MR gate reads every page of open merge requests. `--per-page 100`
  was the first hundred, not the result set, so a busy tracker silently lost the
  duplicate check — and the gate's failure mode is a clean pass, so nothing said
  so. It also now reports an unreadable or unparseable response instead of
  degrading quietly, and carries a `--self-test` whose central case is a collision
  on page two.
- `scripts/release.sh`'s duplicate-tag guard read `git tag | grep -q "^${TAG}$"`.
  Under `set -o pipefail` the early-exiting `grep -q` SIGPIPEs `git tag`, the
  pipeline's status becomes 141, and a tag that **exists** is reported as absent —
  so the release proceeds against a tag it was written to refuse. It is a race on
  how much the writer flushed, so it passes every small local run and fails once,
  on a repo with enough tags. Fifteen further sites across `wt`, `doctor.sh`,
  `customize.sh`, `release-notes.sh`, `assemble-changelog.sh`, `git-ignored.sh`
  and two gate self-tests were converted to here-strings or draining readers.
- Fixed `.claude/rules/*.md` — 408 lines of ported gate and test lessons — being loaded
  by no mechanism Claude Code actually has. Moved the content into `scripts/CLAUDE.md`
  (real, loads today) and `backend/`, `frontend/`, `tests/CLAUDE.md.example` files
  (move into place once your project has that tree), and corrected `CLAUDE.md`'s own
  description of the path-scoping mechanism.

### Security
- Added an `osv-scan` CI job that fails the pipeline on a dependency vulnerability at or
  above a configurable `OSV_SEVERITY_THRESHOLD` (default `HIGH`), classifying
  OSV-Scanner's advisory output with the new `scripts/osv-severity-gate.sh` — previously
  the SAST and secret-detection components reported but nothing gated on severity.
- Added a `gitleaks-scan` CI job and a matching `scripts/gitleaks-precommit.sh` pre-commit
  hook (wired via `scripts/setup-hooks.sh` / `make gitleaks-check`) that blocks a
  hardcoded secret before it is committed, not just after it is pushed. Suppress a
  documented false positive via `.gitleaks.toml`.
## [0.4.0] — 2026-09-14


### Added
- `/batch` — land a wave of milestone issues in parallel, one worktree and one
  delegated agent per issue, each finishing with its own MR. Asks for milestone and
  labels rather than inferring them, defaults agents to Sonnet with four stated
  escalation criteria, caps the wave, and verifies each agent's commits before
  believing its "done". Shaped by an upstream measurement in which cache reads were
  95.9% of subagent spend.
- Per-worktree E2E ports: `scripts/wt new` exports `WT_E2E_PORT` / `WT_E2E_DEV_PORT`,
  derived from the worktree slug and probed past ports a sibling already claims.
  Playwright's `reuseExistingServer` matches on port alone, so without this every
  worktree shares one preview server and a run can go green against another
  branch's bundle.
- `scripts/check-memory-index.sh` and `make memory-check` — fails when the Claude
  memory index exceeds its budget (it is silently truncated past ~24.4 KB) or links a
  memory that does not exist. Not a pre-push gate: its input lives outside the repo.
- `/mass-merge` Step 3b removes each landed MR's worktree right after it merges.
- Rules: every early-exiting reader on a pipe (`grep -q`, `head`, a `while read`
  with `return`) as one SIGPIPE class that fails in both directions; a self-test that
  must tell a crash from a rejection; staging a detector's backlog by rule severity
  instead of `allow_failure`; schema-validated E2E mocks; stateful mocks for specs
  that assert after a write.

### Changed
- `make pre-push-checks` registers one prerequisite per line. Make accumulates
  prerequisites across repeated rule lines, so the target is unchanged; on a single
  line, any two branches that each added a gate conflicted on it. The target now has
  no recipe: on GNU Make 3.81 (the macOS default), a recipe on one of the lines
  reordered the merged prerequisites and would have run `check-collision` last.
- `/mass-merge` polls stay silent between ticks and forbid filler tool calls while a
  poll is pending — upstream, an added per-tick echo turned a four-MR landing into
  150+ near-duplicate notifications.
- `/mr` ends its report with the `scripts/wt prune` step, since nothing reaps a
  worktree after a forge merge.
- `README.md` now opens with what Blueprint is, who it is for, what it is not, and
  why a project should start from it, followed by one numbered guide from an empty
  directory to the first merged MR, with a check after each step. The guide adds the
  steps the old fast track skipped: connecting `origin`, protecting `main`, creating a
  milestone before `/dotplanning`, and configuring `lint` / `typecheck` **before**
  `make setup`. The Makefile ships those two targets as failing stubs, and the
  pre-commit hook runs both, so installing the hooks first blocks every commit.
- Corrected README instructions that did not match the repository. `claude --auto` is
  `claude --permission-mode auto`. `wt new` applies no claim label. `hooks/pre-push`
  runs `make pre-push-checks`, not `make lint`. The global rules file is appended
  rather than copied over an existing `~/.claude/CLAUDE.md`. The docs-site, fuzzing,
  and static-analysis sections are now marked as patterns to adopt, not shipped jobs.
- `CONTRIBUTING.md` no longer says `docs/*` and `ci/*` branches are exempt from
  `changelog-check`. Only `chore/*` is skipped by branch name.

### Fixed
- **`scripts/wt prune` kept merged worktrees forever**: a branch counted as merged
  only when its local tip was an ancestor of the default branch, so a tip rewritten
  after its last push (an amend, a local rebase, a forge-side rebase) or a squash
  merge was reported as `commits NOT in origin/main` and never reaped, and a
  worktree with a tracked `.envrc` or `.wt-owner` counted as having local work. Prune
  now also accepts a branch whose every patch is already in the default branch
  (`git cherry`) or whose merged MR/PR head is exactly the local tip, and every lookup
  failure still keeps the worktree. The WIP-cap error points at `scripts/wt prune`.
- **`/fix-mr` reported a conflicted MR as ready to merge**: it read only pipeline
  status. It now reads `detailed_merge_status` alongside `head_pipeline`, routes on
  the pair, carries a conflict-resolution step (check the worktree for an unpushed
  resolution first; resolve between markers, never from `git show :2:`), and reports
  ready only when both axes agree. It also no longer passes `glab mr list` a
  `--state` flag the CLI does not have.
- **The WIP cap was documented as 5** in `CLAUDE.md` and the `scripts/wt` header;
  the code has used 10 (warn at 8).
## [0.3.0] — 2026-09-05


### Added
- `scripts/check-gate-selftest-parity.sh` — asserts every CI gate runs its own
  `--self-test` **in the job that runs the real scan**, or carries a recorded
  `EXTERNAL` opt-out. Same job is the only way to say "same image" in a CI config,
  and the image is what rots: upstream, both gates that had gone blind already had
  passing test suites, running on a different image. Wired into `make pre-push` and
  CI, and each existing gate now self-tests in its own job.
- `/sunset-check` — decides whether an existing surface should be removed, fixed,
  narrowed, or demoted. Inverts the `/voc` question to "this is gone next release,
  what breaks for you?" and scores removal cost rather than adoption, which `/voc`
  structurally cannot: its rubric gives the same digit to "removing this would be
  bad" and "this thing is bad". Reads the code before scoring, and treats an
  oversold surface as having no status-quo option.
- `scripts/adr-accepted-issue-sweep.py` and an `## On Acceptance` block in the ADR
  template — when an ADR moves to `Accepted`, re-read the open issues that name it.
  An issue arguing for an ADR is written before the ADR settles, and the delta
  between them is exactly the set of **rejected** options. Deliberately not a CI
  gate.
- An `Implementation status` blockquote convention for ADRs where `Accepted` does
  not mean shipped — a blockquote rather than a second field line, because it must
  stay invisible to a status parser.
- `/voc` now grounds itself before convening: it searches the project's tracker,
  then external practitioner discourse about the functional *category*, and records
  an E0–E3 evidence tier in its provenance banner. The old binary collapsed "we
  looked in the one place that is structurally empty" into "there is no evidence
  anywhere".
- A milestone-commitment axis — one scoped `release::committed` / `release::reserve`
  / `release::stretch` label per issue in a dated milestone, which an agent **asks**
  about and never infers.

### Changed
- `/mass-merge` now brings each MR up to the default branch with the operation the
  forge itself will use, read from a new per-project `MERGE_METHOD` setting, instead
  of always rebasing. On a merge-method project the rebase was the only step in the
  flow performing an operation the forge never performs: it conflicts once per
  replayed commit where a merge resolves once, conflicts spuriously on any branch
  already carrying a merge from the default branch, and forces a force-push that a
  merge does not need. The skill also stops prescribing the
  `--force-with-lease="$BR:<sha>"` form, which silently drops the lease on git
  2.50.1 and degrades to a plain rejected push with no "stale info" tell; adds a
  `merge-base --is-ancestor` guard so an already-up-to-date branch is not pushed
  into a pipeline that is never created; matches `source == 'push'` on the
  default-branch poll only; and replaces the `while :; …; sleep 30; done` poll shape
  — which cannot run at all, because foreground `sleep` is blocked in the agent
  harness — with bounded background `for` loops.

### Fixed
- `wt <subcommand> --help` prints usage instead of creating a branch. The top-level
  dispatcher handled `--help` only as the first argument, and every `cmd_*` parser
  ends by taking an unrecognised token as a branch name or needle — so `wt new
  --help` created `feat/help` and a worktree to go with it. A per-subcommand
  argument guard now runs before each parser, and rejects any undeclared
  leading-dash token: a mistyped `--forse` silently becoming a positional is the
  same bug wearing a worse name.
- `wt remove <name-that-matches-nothing>` now says so. `find_worktree`'s `grep`
  exited 1 on no match, `set -o pipefail` promoted it, and `set -e` killed the
  script at the caller's plain assignment — one line before the `die` that would
  have named the needle. The user got exit 1 and no output at all.
- The `gate-self-tests` Make target ran `release-notes.sh --self-test` and the CI
  job of the same name did not. That is precisely the drift the new parity gate
  exists to catch.
- `scripts/assemble-changelog.sh` no longer turns a wrapped fragment into one
  bullet per line. Its normaliser prefixed `- ` to any line that did not already
  start with `- ` or two spaces, so a fragment written as a paragraph — and any
  unindented continuation under a real bullet — was shredded. A new bullet now
  starts only at the top of a fragment or after a blank line; everything else
  continues the bullet above it, `* ` bullets are passed through instead of
  double-prefixed, and a fragment saved without a trailing newline keeps its last
  line (`read` returns non-zero there, and the loop was dropping it).
- `scripts/release.sh` no longer strands the `[Unreleased]` divider inside the
  release it just cut. The rotation was a `sed` rename followed by an `awk`
  prepend, so the `---` sitting under the old `## [Unreleased]` heading stayed put
  and ended up between the new version's heading and its first entry — and since
  the fresh Unreleased block carries the same divider, the artifact reproduced
  itself at every subsequent release. It is now one pass, it swallows the old
  separator, and it fails loudly if the expected version heading did not appear.
- Both behaviors now ship a `--self-test`, run in CI and by `make gate-self-tests`.
  Each was verified to fail on the previous code.
## [0.2.0] — 2026-08-29

> **Why 0.2.0, and why still `0.x`.** The `0.1` tag in this repository was a marker,
> not a release. This first release cut through the release process takes 0.2.0
> rather than reusing a number the repository has already spent.
>
> It stays in `0.x` deliberately: under [semver](https://semver.org/#spec-item-4),
> major version zero means the public surface is not yet stable, and for a blueprint
> that surface is its file layout, skill names, and script interfaces — all still
> moving.

### Added
- Add `frontend/CLAUDE.md.example` — design system skeleton for projects with a frontend
- Add "Git workflow discipline" section to CLAUDE.md — heredoc enforcement, branch-from-main rule, fetch-before-compare, rebase sequence for batched MRs, no auto-merge, pre-release gate pattern
- Fast-track blueprint workflow: `/dotplanning` (plan a release milestone → self-contained HTML report) and `/kaizen` (audit the harness for friction), plus three new review agents — `rbac-check`, `threat-model`, and `accessibility`. A `Fast paths by change class` table and a parallel pre-MR gate batch run only the gates each change needs. Adds a pre-MR security-gate hook (`UserPromptSubmit`) and a `permissions` block to `.claude/settings.json`.
- **Gate integrity toolkit.** Three properties every check script now carries, each
  ported from a case where a gate reported OK on a violating tree:
  - `--self-test` on `check-stale-references.sh` and `check-prepush-parity.sh`, run by
    `make gate-self-tests` and by CI *before* the gates themselves. A gate that cannot
    demonstrate a red is not evidence.
  - `scripts/lib/git-ignored.sh` (`is_ignored`, `drop_ignored_lines`) so a tree-scanning
    gate reads the repository rather than the working directory — the failure mode is a
    false RED locally, on a file CI's clean clone can never see.
  - Fail-closed oracle handling: an unreachable issue tracker fails the gate, with one
    named opt-out (`ALLOW_UNRESOLVED=1`).
- **`scripts/check-prepush-parity.sh`** — derives the CI gate set from the CI
  configuration and fails when a gate script has no `Makefile` mirror or recorded reason.
  Keeps `make pre-push` from going green about a smaller set than CI checks.
- **`scripts/check-stale-references.sh`** — `STUB`/`WIP` markers never merge, and
  `TODO(#N)` / `SUPPRESSED-UNTIL(#N)` must name an open issue. Runs on MRs and on a
  schedule against the default branch, because a marker going stale is not a diff event.
- **`.claude/rules/gates.md`** — path-scoped rules for authoring gates, auto-loaded when
  editing `scripts/` or CI config.
- **`/mass-merge`** — land a batch of already-green MRs without reddening the default
  branch. Whole-tree aggregate and ratchet gates **do not compose across MRs**: each MR's
  pipeline sees only its own tree, so two changes each under a ceiling can be over it
  combined, visible only after merge. Phase A stacks the batch locally and re-runs those
  gates after each add; Phase B lands only the safe prefix serially, rebasing each MR onto
  the latest default branch and gating on a green default-branch pipeline before the next
  merge. User-invoked only — it force-pushes and merges.
- **`schema-check` agent** — migration and constraint safety, run **before push** rather
  than before MR. Migrations usually run on container start, so a failing one is a crash
  loop on every replica with the old version already gone, not a rollback-able deploy. Its
  headline check: a constraint added to a populated table validates against every existing
  row, and `makemigrations --check`-style gates never open a database, so that class has no
  gate by default. Replaces a commented-out "add this yourself" suggestion in `CLAUDE.md`.
- **`generated-artifact-check` agent** — staleness and shape drift in generated or
  hand-mirrored contracts (OpenAPI schema, shared types, SDKs, protobuf). Covers the two
  failure modes a drift gate cannot see: an artifact regenerated on a branch that is behind
  the default branch silently drops paths added since the branch point *and still passes
  the drift check*, and a shared-venv worktree regenerates the **main checkout's** artifact.
- **`/voc-audit`** — VoC panel against a surface that has already shipped. The load-bearing
  step is verification before the tracker is touched: each finding is checked against the
  code and marked survived / falsified / surfaced-during-verification, so model output is
  never filed as fact. Includes `--calibrate` to score predictions against real reports.
- **`/memory-audit`** — enforcement for the memory-discipline policy added in this release.
  A policy with no sweep is a rule that lives only in prose. Finds missing `description:`
  fields (the only retrieval handle), multi-fact files, index lines that are bare pointers,
  dead wiki-links, and grounding claims naming things that no longer exist. Never deletes
  to shrink the store.
- Added `scripts/check-issue-collision.sh` — a push-time gate that blocks a second merge request for an issue another branch is already working, and warns when an issue is claimed by label but has no MR yet. Wired into `make pre-push-checks` so it runs before the slower code gates. Works with `glab` and `gh`; a no-op when neither is installed. Override with `ALLOW_DUP_MR=1` for deliberate stacked work.
- Added three structural parallel-safety guards to `scripts/wt`, so concurrent `wt new` / `wt prune` across sessions is safe by construction rather than by coordination: branches are created with `--no-track` (a fresh worktree can no longer be misread as merged-and-deleted and reaped mid-use), each worktree carries a `.wt-owner` marker honored by a `WT_GRACE_MIN` freshness window during prune, and each generated `.envrc` exports a unique `WT_TEST_DB` so parallel test runs get isolated databases without an external lock. `wt list` now shows age and pushed-state per worktree.
- Add pre-release gate workflow to agent workflow section — one-time audit, not an iterative fix loop
- **README: how the harness is actually used.** Four new sections, plus a "where to
  start" table at the top that routes by intent rather than by file layout.
  - **Issues are the unit of work** — the three mechanisms that key off the issue number
    (worktree claim, push-time collision gate, `Closes #N`), the loop from
    `glab issue view` to `wt remove`, and how to write issues the harness can use. Names
    the trap that a facet recorded as a *comment* on an open issue is not tracked and
    dies when the host closes on a different facet.
  - **Working the harness — a day in the life** — the VS Code layout of one terminal per
    worktree, each running a Claude Code session with auto mode on; what auto mode does
    and does not change; and why the main checkout never runs a feature session.
  - **How the tests test themselves** — the layer table (what each layer answers and how
    it lies), watch-it-fail, gate self-tests, contract fuzzing plus the coverage gate that
    sits on the fuzzer's own output, and suppression-integrity gates for static analysis.
    States plainly that `allow_failure: true` means a pipeline reads `success` while the
    job inside it failed.
  - **Documentation — Astro Starlight on GitLab Pages** — the `website:build` / `pages`
    split, why a zero exit from `astro build` is not proof the docs rendered, and how a
    page declares which version it describes.
- **`scripts/wt` WIP cap raised to 10 (warn at 8)** from 5/4, with the per-invocation
  override documented for bursty development. The cap is a WIP guard, not a resource
  limit — it is doing its job at exactly the moment it annoys you.
- **`scripts/release-notes.sh`** — generates `docs/releases/v<version>.md` from the
  rotated CHANGELOG plus the commit range since the previous release tag, and
  `scripts/release.sh` now calls it. It replaces a `RELEASE_NOTES` variable that was
  computed in `release.sh` and then **never used** — so every release shipped with
  whatever someone pasted into the forge UI by hand, or with nothing.
  - Two sections, deliberately: **What is included** (the version's CHANGELOG section,
    curated) and **Changes since v<previous>** (every non-merge commit, mechanical). A
    commit in the second with no counterpart in the first is a **missing changelog
    fragment** — which is exactly what a curated list cannot tell you about itself.
  - Only `vMAJOR.MINOR.PATCH` tags count as a previous release. A non-semver tag is
    **reported but not treated as a predecessor**: "there is no previous release" and
    "there is an older tag that was never a release" are different facts, and the reader
    needs the second one.
  - Ships with `--self-test` (run by `make gate-self-tests`), including the case that
    matters most — a version with no CHANGELOG section must **fail**, not emit empty notes.
- Add global CLAUDE.md example, PreToolUse safety hooks, `/review` skill, `.gitattributes`, and dependency update configs (Renovate + Dependabot)
- **`scripts/wt stash`** — worktree-private stash under `refs/wt-stash/<worktree>`.
  `git stash` is not worktree-scoped: `refs/stash` lives in the git common dir, so every
  worktree shares one stack and a clean `pop` in one worktree can apply *and drop*
  another session's uncommitted work, with nothing in either session's output naming it.
  `wt doctor` now warns when `refs/stash` is non-empty while worktrees are active.

### Changed
- Tighten `ux-review`, `docs`, `perf-check`, and `security-review` agents with stack-agnostic regression-class checks ported from a downstream pre-release audit: focus-visible vs focus gate, sub-minimum text gate, raw color-shade gate, count-bearing button aria-label, hover-reveal focus rule, admin-hidden-not-disabled rule, behavior-drift narrative-prose sweep, eager-load bypass on aggregations/ordering, computed-field annotation-fallback, ORM-in-deferred-closures, per-recipient push-channel filter, and post-revocation data retention.
- Auto-skip changelog check for `chore/` branches in CI pipeline
- **`/mr` now emits a `## Gates` section** — one machine-readable
  `gate: <name> — <outcome>` line per gate. `0 findings` is a required outcome, `n/a`
  and `skipped` are distinct states, and counts are never padded: the ledger exists so
  gates can be *removed*.
- **`/kaizen` gained a gate-yield signal** — parses `## Gates` lines across recent merged
  MRs into a per-gate find-rate table, so a gate that never changes an outcome can be
  fast-pathed and a load-bearing one can be defended.
- **`.claude/rules/tests.md`: watch the test fail first.** Catalogues the vacuous-test
  shapes that pass review and pass on the unfixed build — absence assertions that sample
  before the action fires, self-cancelling key sequences, substring name matches that
  bind to a neighboring node, parameterized guards whose parameter is ignored.
- **`global-claude-md.example`**: full memory-discipline policy (`MEMORY.md` vs
  `MEMORY-archive.md`, three eviction triggers, verify-the-referent), a CI-failure triage
  section (branch-ref greens, allow-failure jobs hidden inside a `success` pipeline,
  stale-base reds, tracker-oracle reds), and the shell/git traps that destroy work
  silently.
- **`scripts/wt`** no longer exits when the repo has no `origin/HEAD` — the `:-main`
  fallback was unreachable under `set -euo pipefail`.
- README now front-loads a five-step fast track (clone → name → feed a spec → `/dotplanning` → build) and a "Built on Claude Code best practices" section; the agent workflow, model table, command reference, and file tree are updated for the new gates. `CLAUDE.md` and `global-claude-md.example` gain the fast-paths table, the parallel pre-MR gate batch, and the `/dotplanning` planning gate.
- Expanded `.claude/rules/tests.md` with the invariants that keep a green suite from being a misleading one: guard against tests that are never collected, new files that never enter the coverage report, and tests that execute a line without asserting on it; enforce hermeticity by banning outbound sockets with a config-derived allowlist; treat an intermittent failure as a bug report rather than something to retry away (one CI retry, zero locally, and a job that fails on retry-only passes); and register a catch-all route first in browser tests while still mocking every endpoint a page actually reads with its real response shape.
- Added a version-status tense rule to `CLAUDE.md` — past-tense version claims may reference shipped versions only, with the roadmap page as the single source of truth — and added rules to `global-claude-md.example` for grepping the E2E spec tree before committing a user-visible change, checking for in-flight work before claiming an issue, and keeping local gates ahead of post-merge static analysis.
- Fixed `scripts/wt list` exiting non-zero on a repository with no secondary worktrees: under `set -o pipefail`, the `grep -v` filtering out every line returned 1 and killed the caller.
- Pre-push hook now runs only full-codebase checks (via `make pre-push-checks`) rather than `make lint` — lint, format-check, and typecheck run at commit time instead, eliminating redundant runs on push.
- **The VoC panel average no longer travels to the architect.** It was previously handed
  over as "scores + key blockers"; an average is not a decision, and passing one along
  invites it to become one. What crosses now is the key blockers with their falsification
  lines plus the "what this panel could not see" open questions. Also states plainly that
  panel output is simulated feedback, that two panels agreeing is not corroboration, and
  that personas are seated by **reachability** rather than role plausibility — a persona
  whose daily work is on another surface marks its criteria N/A and drags the average down,
  producing a low score that means "wrong audience", not "bad feature".
- **Landing several MRs by hand now carries the two rules that survive without
  `/mass-merge`**: rebase before each merge, and space the merges out — landing many
  quickly exhausts CI job capacity, and a pipeline that fails at *creation* reports
  `failed` with zero jobs, having tested nothing.

### Fixed
- **`check-stale-references.sh` no longer excludes `changelog.d/`.** The exclusion was a
  blind spot rather than a scope decision: a fragment carrying a literal marker sat there
  invisible for weeks, and the release assembled it into `CHANGELOG.md` and copied it into
  `docs/releases/` — both scanned — so the gate red its own release MR on content written
  long before. An exclusion does not remove a violation when the excluded content is later
  copied into a scanned location; it defers it to the least convenient moment. Recorded as
  a rule in `.claude/rules/gates.md`.
- **`scripts/assemble-changelog.sh` no longer rejects a fragment whose slug contains a
  dot.** The filename validator required `^[a-zA-Z0-9_-]+\.<type>\.md`, while the type
  parser directly below it reads the *last* dot-separated field and handles dotted slugs
  correctly — so the validator was stricter than the parser it guards, and a fragment the
  assembler could process perfectly aborted the whole release. Found by dry-running the
  first release: `agent-tightenings-from-1.1-audit.changed.md` blocked assembly.
- **`make doctor` now checks the harness's own tooling** — `claude`, `glab`/`gh`, `jq`,
  and `direnv` — in a separate "Harness tooling" section, each miss reported as a warning
  that names the consequence rather than a bare MISSING. Previously it checked only
  `git`, `make`, and `python3`, while the README claimed it verified "git, docker, node,
  python, glab, etc." **None of docker, node, or glab were checked.** A prerequisite
  check that quietly omits a prerequisite is the same failure class as a gate reporting
  OK on a violating tree — the green is believed, and it was never evidence.
- **README gained a "What you need installed" section** stating what each tool is needed
  for and, specifically, what breaks without it: without `claude` the review gates do not
  exist but git/CI/release still work; without `glab` or `gh` the duplicate-work gate
  cannot see open MRs, `wt` cannot claim an issue, and the stale-reference gate fails
  closed.

---
