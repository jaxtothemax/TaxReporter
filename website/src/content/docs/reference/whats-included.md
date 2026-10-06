---
title: What's included
description: Every part of the template, what it does, what to delete if you don't need it, and enhancements worth adding.
---

**The big picture:** Blueprint is about 140 files of process — CI, Git hooks, scripts,
Claude Code agents and skills — and no application code. This page lists all of it.

**Why it matters:** You own everything you clone. Knowing what each part does tells you
what's safe to delete and what's quietly holding something up.

**The bottom line:** Nothing here is mandatory. Delete what you don't need — but delete it
on purpose (see [Removing what you don't need](#removing-what-you-dont-need)).

## By category

| Category | Files | What it gives you |
|---|---|---|
| **Claude agents** | `.claude/agents/` | 17 specialist reviewers and helpers — see [Agents](/reference/agents/) |
| **Claude skills** | `.claude/skills/` | 20 slash-command workflows — see [Skills](/reference/commands/) |
| **Claude hooks** | `.claude/hooks/`, `.claude/settings.json` | Guards that block risky edits, reminders after edits, and a security gate before an MR opens |
| **Claude rules** | `CLAUDE.md`, nested `scripts/CLAUDE.md` and `ci/CLAUDE.md`, `backend/`/`frontend/`/`tests/CLAUDE.md.example`, `global-claude-md.example` | Project rules Claude reads automatically; nested files load only for their folder |
| **Personas** | `.claude/personas.md` | The users `/voc`, `/voc-audit`, and `/sunset-check` role-play |
| **CI pipeline** | `.gitlab-ci.yml`, `ci/*.yml` | Governance jobs out of the box, plus stack templates — see [CI pipeline](/guides/ci-pipeline/) |
| **Git hooks** | `hooks/`, `scripts/setup-hooks.sh` | Pre-commit: secret scan, `format-check`, `lint`, `typecheck`. Pre-push: `make pre-push-checks` |
| **Check scripts (gates)** | `scripts/check-*`, `scripts/osv-severity-gate.sh`, `scripts/gitleaks-precommit.sh`, `load-bearing.declarations`, `.gitleaks.toml` | Checks that each prove they can still fail — see [Harness gates](/reference/harness-gates/) |
| **Parallel work** | `scripts/wt` | One worktree per issue, safe with several sessions at once — see [Parallel work](/guides/parallel-work/) |
| **Changelog** | `changelog.d/`, `scripts/assemble-changelog.sh` | One-line fragments per MR, assembled at release |
| **Release** | `scripts/release.sh`, `scripts/release-notes.sh`, `docs/releases/` | Version bump, changelog assembly, per-release notes |
| **Templates** | `.gitlab/issue_templates/`, `.gitlab/merge_request_templates/` | Bug, Feature, Feedback, and Task issues; a standard MR description |
| **ADRs** | `docs/adr/` | Architecture Decision Records, created with `/adr` |
| **Docs site** | `website/` | This site (Astro Starlight → GitLab Pages). Keep it as a starting point for yours, or delete it |
| **Dependency updates** | `renovate.json`, `.github/dependabot.yml` | Automated update MRs — keep one, delete the other |
| **Setup** | `Makefile`, `scripts/customize.sh`, `scripts/doctor.sh` | `make setup`, `make customize` (setup checklist), `make doctor` (prerequisites) |
| **Conventions** | `CONTRIBUTING.md`, `.gitattributes`, `.env.example` | Branch and commit rules, line endings, example environment |

## Removing what you don't need

- **No frontend?** Delete `ci/node.yml`, the node blocks in the `Makefile`,
  `frontend/`, and the `ux-design`, `ux-review`, and `accessibility` agents.
- **No HTTP endpoints?** Delete the `rbac-check` agent and the
  `pre-mr-security-gate.sh` hook (and its `PreToolUse` entry in `.claude/settings.json`).
- **No docs site?** Delete `website/` and the `website:build` and `pages` jobs in
  `.gitlab-ci.yml`. (`ci/docs.yml` can stay — it does nothing without a docs site.)
- **No Helm chart?** Leave `ci/helm.yml` commented out, or delete it.
- **No CI?** Delete `.gitlab-ci.yml` and `ci/`. The changelog and hooks still work
  locally.
- **No Claude Code?** Delete `.claude/` and `global-claude-md.example`. Everything else
  works on its own.
- **Different license?** Replace `LICENSE`.
- **GitHub instead of GitLab?** Move `.gitlab-ci.yml` to `.github/workflows/` and
  `.gitlab/` to `.github/`; the scripts already use `gh` when `origin` is on GitHub.
  Delete `renovate.json` and keep `.github/dependabot.yml`.
- **GitLab (the default)?** Delete `.github/`; keep `renovate.json`.

**Yes, but:** before deleting a check script, look for it in `load-bearing.declarations`
and the `Makefile`'s `pre-push-checks` list. Deleting a gate cleanly means removing its
callers too.

## Suggested enhancements

| Add | What it gives you | When |
|---|---|---|
| **CODEOWNERS** | Automatic reviewer assignment by path | More than two people with distinct areas |
| **Container image scanning** | CVE scanning of built images (Trivy, GitLab container scanning) | Shipping containers to production |
| **Language vulnerability jobs** | `pip-audit` / `npm audit` alongside `osv-scan` | You want the ecosystem's native advisories too |
| **A richer MR template** | Migration notes, deploy impact, rollback plan | Deploys with migrations or several services |
| **Approval rules** | N approvals before merge, per-path overrides | A formal review process |
| **Merge trains** | GitLab's server-side merge queue | `main` breaks often from concurrent merges (`/mass-merge` is the client-side version) |

Choosing where to deploy is a separate question — see [Deployment options](/guides/deployment-options/).

## Go deeper: the file tree

⛔ marks a skill only you can start (`disable-model-invocation: true`).

```
.
├── .claude/
│   ├── agents/                      # 17 agents — see the Agents page
│   │   ├── accessibility.md         # WCAG 2.1 AA (sonnet, read-only)
│   │   ├── architect.md             # technical approach before code (opus)
│   │   ├── changelog.md             # writes the changelog fragment (sonnet)
│   │   ├── completeness-check.md    # fresh-agent audit of branch vs. issue, before push (sonnet; opus on escalation)
│   │   ├── dependency.md            # license/CVE/justification before adding a package (sonnet)
│   │   ├── docs.md                  # writes and updates docs (sonnet)
│   │   ├── generated-artifact-check.md  # stale schemas, types, SDKs (sonnet)
│   │   ├── perf-check.md            # N+1, unbounded queries (sonnet, read-only)
│   │   ├── rbac-check.md            # access control on endpoints (sonnet, read-only)
│   │   ├── regression-check.md      # what this breaks that used to work (opus; /batch runs it on sonnet)
│   │   ├── schema-check.md          # migration safety, before push (sonnet)
│   │   ├── security-review.md       # OWASP Top 10 + project risks (opus; /batch runs it on sonnet)
│   │   ├── test-scaffold.md         # tests for uncovered code (sonnet)
│   │   ├── threat-model.md          # trust boundaries, before code (opus)
│   │   ├── ux-design.md             # UI proposal, before code (opus)
│   │   ├── ux-review.md             # design-system compliance (sonnet, read-only)
│   │   └── voc.md                   # persona panel (opus)
│   ├── skills/                      # 20 skills — see the Skills page
│   │   ├── adr/SKILL.md                   # /adr
│   │   ├── batch/SKILL.md                 # /batch ⛔
│   │   ├── ci-debug/SKILL.md              # /ci-debug
│   │   ├── dotplanning/                   # /dotplanning ⛔
│   │   │   ├── SKILL.md
│   │   │   ├── kickoff-questions.md       #   the twelve kickoff questions
│   │   │   └── html-output-spec.md        #   report layout
│   │   ├── fix-mr/SKILL.md                # /fix-mr ⛔
│   │   ├── import-design/SKILL.md         # /import-design
│   │   ├── import-spec/SKILL.md           # /import-spec ⛔
│   │   ├── incident-postmortem/SKILL.md   # /incident-postmortem
│   │   ├── kaizen/SKILL.md                # /kaizen
│   │   ├── kickoff/SKILL.md               # /kickoff ⛔
│   │   ├── mass-merge/                    # /mass-merge ⛔
│   │   │   ├── SKILL.md
│   │   │   └── failure-modes.md           #   failure modes and recovery
│   │   ├── memory-audit/SKILL.md          # /memory-audit ⛔
│   │   ├── mr/SKILL.md                    # /mr ⛔
│   │   ├── pre-release/SKILL.md           # /pre-release
│   │   ├── release/SKILL.md               # /release ⛔
│   │   ├── review/SKILL.md                # /review
│   │   ├── sunset-check/SKILL.md          # /sunset-check
│   │   ├── tracker-hygiene/SKILL.md       # /tracker-hygiene
│   │   ├── voc/SKILL.md                   # /voc
│   │   └── voc-audit/SKILL.md             # /voc-audit ⛔
│   ├── hooks/
│   │   ├── on-stop.sh               # Stop-hook example — NOT wired by default
│   │   ├── post-edit-checks.sh      # reminders after an edit
│   │   ├── pre-mr-security-gate.sh  # stops `glab mr create` until security reviews ran
│   │   └── pre-tool-safety.sh       # blocks lock-file and migration edits
│   ├── kaizen-declined.json         # /kaizen proposals you've turned down
│   ├── personas.md                  # your users (replace the examples)
│   └── settings.json                # hooks, allowed and denied commands
├── .github/dependabot.yml           # GitHub dependency updates (delete on GitLab)
├── .gitlab/
│   ├── issue_templates/             # Bug.md, Feature.md, Feedback.md, Task.md
│   └── merge_request_templates/     # Default.md
├── backend/CLAUDE.md.example        # backend rules — move into place when you have a backend
├── changelog.d/README.md            # fragment naming guide
├── ci/
│   ├── CLAUDE.md                    # rules for editing CI (imports scripts/CLAUDE.md)
│   ├── docker.yml                   # kaniko build, compose project names
│   ├── docs.yml                     # internal docs link check (included by default)
│   ├── go.yml                       # golangci-lint, go test, govulncheck
│   ├── helm.yml                     # chart registry drift, install/upgrade drills
│   ├── node.yml                     # eslint, vitest, license check, added-file coverage
│   ├── python.yml                   # ruff, pytest, license check, app-aware gates, fuzz, load test
│   └── sonar-complexity.yml         # cognitive-complexity tier (off by default)
├── docs/
│   ├── adr/                         # ADR format guide and seed ADR
│   └── releases/                    # Blueprint's own release notes (replace with yours)
├── frontend/CLAUDE.md.example       # frontend rules — generate with /import-design
├── hooks/
│   ├── pre-commit                   # secret scan, format-check, lint, typecheck (each if defined)
│   └── pre-push                     # make pre-push-checks
├── scripts/
│   ├── CLAUDE.md                    # rules for writing check scripts
│   ├── lib/
│   │   ├── git-hooks-dir.sh         # finds the real hooks folder (works in worktrees)
│   │   └── git-ignored.sh           # lets checks skip ignored files, like CI's clean clone
│   ├── tests/                       # tests for wt, setup, onboarding, the security hook, app-aware gates
│   ├── adr-accepted-issue-sweep.py  # open issues written before the ADR they cite
│   ├── assemble-changelog.sh        # fragments → CHANGELOG.md
│   ├── check-added-files-covered.mjs    # a new source file missing from the coverage report
│   ├── check-artifact-assertions.sh     # tag jobs assert their artifacts aren't empty
│   ├── check-chart-registry.sh          # the published Helm chart installs as documented
│   ├── check-cognitive-complexity.py    # complexity tier for script entry points
│   ├── check-compose-project-names.sh   # each compose file pins its own project name
│   ├── check-docs-internal-links.py     # docs links, anchors, and assets resolve
│   ├── check-gate-selftest-parity.sh    # every gate self-tests in its own CI job
│   ├── check-issue-collision.sh         # blocks a duplicate MR for an issue
│   ├── check-load-bearing.sh            # declared one-line guards still exist
│   ├── check-memory-index.sh            # Claude memory index size and dead links
│   ├── check-migration-numbering.sh     # migration numbers that collide on the merged tree
│   ├── check-mr-followups.sh            # a mentioned follow-up must cite an open issue
│   ├── check-nul-bytes.sh               # no NUL bytes in text files
│   ├── check-prepush-parity.sh          # every CI gate can also run before push
│   ├── check-release-pipeline.sh        # a tag can't publish from a failed commit
│   ├── check-serializer-ts-parity.py    # backend schema and TypeScript types agree
│   ├── check-shellcheck.sh              # every shell script passes shellcheck
│   ├── check-sigpipe-readers.sh         # no early-exit reader behind a pipe
│   ├── check-stale-references.sh        # STUB/WIP, TODO(#N) pointing at closed issues
│   ├── check-tag-only-jobs.sh           # tag-only CI jobs changed since the last tag
│   ├── check-version-lockstep.py        # every version-bearing file agrees
│   ├── check-ws-event-reachability.py   # published real-time events are actually reachable
│   ├── ci-assert-artifacts.sh           # helper: fail a publish job with an empty artifact
│   ├── customize.sh                     # setup checklist (reports, never edits)
│   ├── doctor.sh                        # prerequisite check
│   ├── gitleaks-precommit.sh            # secret scan for the pre-commit hook
│   ├── helm-install-drill.sh            # install + upgrade the chart on a real kind cluster
│   ├── nightly_load_test.py             # p95 latency budgets
│   ├── osv-severity-gate.sh             # fail on dependency CVEs above a threshold
│   ├── release-notes.sh                 # docs/releases/<version>.md
│   ├── release.sh                       # version bump + changelog assembly
│   ├── schemathesis_hooks.py.example    # starter hooks for the schema fuzz job
│   ├── setup-hooks.sh                   # installs hooks/ into Git
│   └── wt                               # worktree helper: issue check-out lock, private `wt stash`
├── tests/CLAUDE.md.example          # test-writing rules
├── website/                         # this docs site
├── .env.example
├── .gitattributes                   # line endings, merge strategies, binary detection
├── .gitignore
├── .gitlab-ci.yml                   # governance CI + stack includes
├── .gitleaks.toml                   # secret-scan config and allowlist
├── CHANGELOG.md
├── CLAUDE.md                        # project rules for Claude Code
├── CONTRIBUTING.md                  # contributor workflow
├── LICENSE                          # Apache 2.0 (change if you like)
├── Makefile                         # setup, customize, doctor, lint, test, build, checks
├── README.md
├── global-claude-md.example         # copy to ~/.claude/CLAUDE.md
├── load-bearing.declarations        # one-line guards that must not disappear
├── nightly-load-test-budgets.json   # latency budgets for the load test
└── renovate.json                    # GitLab dependency updates (delete on GitHub)
```
