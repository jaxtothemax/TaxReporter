# ─── Project Template Makefile ────────────────────────────────────────────────
#
# Canonical command interface. Every project speaks the same language:
#   make setup    — first-time setup (install hooks, dependencies)
#   make lint     — run linters
#   make test     — run test suite
#   make build    — build artifacts
#   make doctor   — check prerequisites and environment
#
# The application is a TypeScript pnpm workspace (packages/*, apps/*); its
# targets are in the "Application" section below.

.PHONY: setup install-deps lint format format-check typecheck test build doctor customize clean pre-push-checks check-collision check-selftest-parity check-version-lockstep check-licenses print-coverage-layers release-pipeline-check gitleaks-check check-nul-bytes check-complexity

# ─── Universal targets ────────────────────────────────────────────────────────

setup: install-hooks install-deps  ## First-time project setup (install hooks and the pnpm workspace)
	@echo "Setup complete. Run 'make customize' to check template configuration."

customize:  ## Check and guide template customization (run after cloning)
	@bash scripts/customize.sh

install-hooks:
	@scripts/setup-hooks.sh

doctor:  ## Check prerequisites and environment health
	@scripts/doctor.sh

# ─── Application (TypeScript, pnpm workspace) ────────────────────────────────
#
# Apart from install-deps and clean, each target runs one root package.json
# script through pnpm. The pre-commit hook (format-check, lint, typecheck) and
# every job in .github/workflows/ci.yml call these SAME targets, so a green
# result means the same thing on a laptop, in a hook and in CI. Change a
# command in package.json, never in a copy of it.
#
# Prettier and ESLint see only packages/, apps/ and the root tooling config,
# never the harness (scripts/, hooks/, .claude/, docs/, website/, root *.md):
# .prettierignore and the globalIgnores block in eslint.config.js are
# allowlists that say so.

install-deps:  ## Install the pnpm workspace exactly as pnpm-lock.yaml pins it
	@# --frozen-lockfile, as CI does: a lockfile that does not match package.json
	@# is an error, not something to rewrite quietly. Changing a dependency is a
	@# `pnpm add` / `pnpm remove` that commits the new lockfile alongside it.
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm not found — install it (https://pnpm.io/installation, or 'corepack enable pnpm'), then re-run." >&2; exit 1; }
	pnpm install --frozen-lockfile

lint:  ## ESLint (typescript-eslint, type-aware) over the application and its config
	pnpm run lint

format-check:  ## Check Prettier formatting without writing (used by the pre-commit hook)
	pnpm run format:check

format:  ## Rewrite the application and its config in Prettier style
	pnpm run format

typecheck:  ## tsc -b over every project reference in tsconfig.json (tests and config included)
	pnpm run typecheck

test:  ## Vitest over every package, with v8 coverage to coverage/cobertura-coverage.xml
	@# That Cobertura report is what check-added-files-covered reads, locally and
	@# in CI's added-files-covered job.
	pnpm run test

build:  ## Build every package (tsc) and both apps: apps/cli/dist and apps/web/dist
	@# The web app's public path comes from TAXREPORTER_WEB_BASE (default "/");
	@# the GitHub Pages build will set /app/. See apps/web/vite.config.ts.
	pnpm run build

clean:  ## Remove build output, coverage and TypeScript build state (never node_modules)
	@# Generated output only: `make clean && make build` must not need a reinstall.
	rm -rf coverage packages/*/dist apps/*/dist
	rm -f ./*.tsbuildinfo packages/*/*.tsbuildinfo apps/*/*.tsbuildinfo

# ONE PREREQUISITE PER LINE. Make accumulates prerequisites across repeated rule
# lines, so this is the same target as one long line. It is split because every new
# gate is registered here: on a single line, any two branches that each add a gate
# conflict on it. Add each project check (schema drift, fixture regeneration, generated-file
# freshness) as its own `pre-push-checks: <target>` line, in the order it should run.
#
# NO RECIPE on any of these lines, and keep it that way. On GNU Make 3.81 (the macOS
# default), giving one of them a recipe while the others carry the prerequisites
# reorders the merged list — `a b c` ran as `b c a`, which would move
# check-collision from first to last. Recipe-less lines keep their written order.
pre-push-checks:  ## Full-codebase checks run before push (override per project)
pre-push-checks: check-collision
pre-push-checks: check-parity
pre-push-checks: check-selftest-parity
pre-push-checks: check-version-lockstep
pre-push-checks: check-sigpipe
pre-push-checks: check-artifact-asserts
pre-push-checks: check-shellcheck
pre-push-checks: check-docs-links
pre-push-checks: check-nul-bytes
pre-push-checks: check-load-bearing
pre-push-checks: check-added-files-covered
pre-push-checks: check-app-fixture-gates
pre-push-checks: check-licenses

check-collision:  ## Block a push that would open a duplicate MR for an issue
	@# Runs FIRST, before the slower code gates: finding out you duplicated
	@# another session's issue is cheapest before the lint/typecheck minutes.
	@bash scripts/check-issue-collision.sh

check-parity:  ## Assert every CI gate script is runnable before push
	@# Keeps `make pre-push` honest. Without it the mirror list is a historical
	@# accretion: correct the day it is written, silently incomplete after.
	@bash scripts/check-prepush-parity.sh

check-selftest-parity:  ## Assert every CI gate proves it can fail, in its own job
	@# The bookend to check-parity. That one asks "can a developer run this gate";
	@# this one asks "can this gate still say no". A gate's failure mode is a GREEN
	@# pipeline, so nothing else in the run would ever report it.
	@bash scripts/check-gate-selftest-parity.sh

check-version-lockstep:  ## Every version-bearing manifest agrees, and none is behind the changelog
	@# Repo-only and fast, so it belongs in pre-push. It runs on every MR rather
	@# than at tag time because by tag time the artifact is already being built
	@# from whichever manifest drifted.
	@python3 scripts/check-version-lockstep.py

check-artifact-asserts:  ## Tag-triggered jobs assert their declared artifacts:paths are non-empty
	@# Static and repo-only (~100ms). A tag-only job runs nowhere but on a tag, so
	@# this wiring is the only thing that can be proven before the release itself.
	@bash scripts/check-artifact-assertions.sh

check-sigpipe:  ## No early-exit reader (grep -q / head) behind a pipe in any shell script
	@# In pre-push-checks because it is repo-only, ~50ms, and its failure class is
	@# a gate or a release guard silently reporting the opposite of the truth.
	@bash scripts/check-sigpipe-readers.sh

check-shellcheck shellcheck:  ## shellcheck over scripts/, hooks/, .claude/hooks/
	@# In pre-push-checks because it is repo-only and fast. Skips (does not fail)
	@# if shellcheck is not installed locally — CI always has it.
	@bash scripts/check-shellcheck.sh

check-docs-links:  ## Internal doc links/anchors/assets resolve (skips if no docs site)
	@# Mirrors ci/docs.yml's `exists:` gate rather than inventing an OPT_OUT
	@# category: no docs site in this clone is a "skip", the same shape
	@# check-shellcheck below uses for an absent tool, not a failure. DOCS_ROOT
	@# and DOCS_CONFIG default to the recommended Astro Starlight shape and can
	@# be overridden the same way as here and in ci/docs.yml if your project's
	@# docs site does not use it — see scripts/check-docs-internal-links.py.
	@if [ -f "$${DOCS_CONFIG:-website/astro.config.mjs}" ]; then \
		python3 scripts/check-docs-internal-links.py \
			--docs-root "$${DOCS_ROOT:-website/src/content/docs}" \
			--config "$${DOCS_CONFIG:-website/astro.config.mjs}"; \
	else \
		echo "No docs site detected ($${DOCS_CONFIG:-website/astro.config.mjs} not found) — skipping check-docs-links."; \
	fi

check-nul-bytes:  ## No tracked text=set file contains a literal 0x00 byte
	@# In pre-push-checks because it is repo-only and fast (one python3 pass
	@# over the whole index). A NUL makes git classify the file BINARY, which
	@# defeats every other grep-based gate on it silently — catching it here
	@# is cheaper than debugging a false-clean scan later.
	@bash scripts/check-nul-bytes.sh

# The coverage "layers" check-added-files-covered.mjs checks: every TypeScript
# file added under packages/ or apps/ must appear in the ONE Cobertura report
# `make test` writes, minus the coverage exclusions vitest.config.ts declares
# (read from that file, so the gate and Vitest cannot disagree about what
# counts as source). Defined once, here: ci.yml's added-files-covered job reads
# it through `make -s print-coverage-layers` rather than keeping a copy.
COVERAGE_LAYERS := \
	--layer packages/:ts,tsx:coverage/cobertura-coverage.xml:vitest.config.ts:vitest \
	--layer apps/:ts,tsx:coverage/cobertura-coverage.xml:vitest.config.ts:vitest

print-coverage-layers:  ## Print the --layer flags of check-added-files-covered (read by ci.yml)
	@echo $(COVERAGE_LAYERS)

check-added-files-covered:  ## Every added source file appears in its coverage report (skips if node is absent)
	@# Skips (does not fail) when `node` is not installed locally — same shape as
	@# check-shellcheck's absent-tool skip. CI's added-files-covered job
	@# (.github/workflows/ci.yml) always has node; this is a local-dev
	@# convenience. Each layer skips on its own, with an INFO line, while its
	@# coverage report does not exist yet — run `make test` first.
	@#
	@# --no-fetch: without it the script runs `git fetch --depth=100` against
	@# origin, which turns a full clone SHALLOW (it truncates your local history)
	@# and puts the network inside an offline pre-push. It diffs against your
	@# local origin/main instead; CI diffs against a complete checkout.
	@if command -v node >/dev/null 2>&1; then \
		node scripts/check-added-files-covered.mjs --no-fetch $(COVERAGE_LAYERS); \
	else \
		echo "node not installed — skipping check-added-files-covered."; \
	fi

check-app-fixture-gates:  ## Added-files coverage gate passes a real app fixture and rejects seeded drift (#52)
	@# Until the application exists there are no added source files and no
	@# coverage reports, so check-added-files-covered skips on this tree. This
	@# runs it against an app fixture generated into a temp dir — see
	@# scripts/tests/app-fixture-gates.test.sh. Needs python3 and node; skips
	@# (does not fail) without node, the same absent-tool shape as
	@# check-added-files-covered. CI's app-fixture-gates job always has both.
	@if command -v node >/dev/null 2>&1; then \
		bash scripts/tests/app-fixture-gates.test.sh; \
	else \
		echo "node not installed — skipping check-app-fixture-gates."; \
	fi

check-licenses:  ## Every dependency's license is AGPL-3.0-compatible (skips if node or pnpm is absent)
	@# In pre-push-checks because its input is the repository: pnpm-lock.yaml pins
	@# every package, and a failure is fixed by a commit (drop the dependency, or
	@# add a reasoned EXCEPTIONS entry). Offline once installed — `pnpm licenses
	@# list` reads the local store. Skips without node or pnpm, the same
	@# absent-tool shape as check-added-files-covered; with them, an unreadable
	@# dependency tree is exit 2, never a pass. CI's license-compliance job
	@# always has both.
	@if command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then \
		node scripts/check-licenses.mjs; \
	else \
		echo "node or pnpm not installed — skipping check-licenses."; \
	fi

check-load-bearing:  ## Every call site declared load-bearing is still present
	@# In pre-push-checks because it is repo-only and fast (one grep per
	@# declaration). Its failure class is the one nothing else reports: a guard
	@# wired in by a single line, deleted, with every test still green. A clone
	@# that has declared nothing passes trivially and says so — see
	@# load-bearing.declarations for when a call site earns a declaration.
	@bash scripts/check-load-bearing.sh

check-stale-refs:  ## STUB/WIP markers, and TODO(#N)/SUPPRESSED-UNTIL(#N) against closed issues
	@# NOT in pre-push-checks on purpose: its oracle is the issue tracker, so a
	@# failure can appear with no diff to cause it and no commit that fixes it.
	@# Runs in CI on MRs and on a schedule against the default branch.
	@bash scripts/check-stale-references.sh

gitleaks-check:  ## Scan staged changes for secrets with gitleaks (also runs as a pre-commit hook)
	@# NOT in pre-push-checks: it scans `--staged` content, which is normally
	@# empty by push time — a no-op there would be false confidence, not a
	@# check. It runs at commit time (hooks/pre-commit, via scripts/setup-hooks.sh)
	@# and on every push in CI regardless (gitleaks-scan, full working-tree scan).
	@bash scripts/gitleaks-precommit.sh

check-complexity:  ## Cognitive-complexity tier for script entry points (opt-in, ci/sonar-complexity.yml — issue #41)
	@# NOT in pre-push-checks: it is OFF BY DEFAULT by design — a proxy metric
	@# that false-positives on legitimately branchy dispatch code, gated behind
	@# ci/sonar-complexity.yml's commented-out include so no clone gets it
	@# without choosing it. It CAN run offline in seconds (no external
	@# oracle, no build artifact) — that disqualifies it
	@# from OPT_OUT in check-prepush-parity.sh, which is reserved for gates that
	@# genuinely cannot run locally, not gates a project has not opted into. A
	@# project that DOES opt in should fold this into its own pre-push-checks.
	@python3 scripts/check-cognitive-complexity.py

gate-self-tests:  ## Prove the check scripts can still fail
	@# A gate is only worth its green if it can go red. Each script synthesizes a
	@# violating fixture and asserts it is rejected.
	@#
	@# This target is a local convenience. It is NOT what proves the property in
	@# CI — there each gate runs its own --self-test inside its own job, because
	@# the environment is what rots and a self-test in a different job runs on a
	@# different image. `check-selftest-parity` is what enforces that.
	@bash scripts/check-stale-references.sh --self-test
	@bash scripts/check-issue-collision.sh --self-test
	@bash scripts/check-prepush-parity.sh --self-test
	@bash scripts/check-gate-selftest-parity.sh --self-test
	@bash scripts/assemble-changelog.sh --self-test
	@bash scripts/release.sh --self-test
	@bash scripts/release-notes.sh --self-test
	@bash scripts/check-tag-only-jobs.sh --self-test
	@python3 scripts/adr-accepted-issue-sweep.py --self-test
	@bash scripts/check-memory-index.sh --self-test
	@bash scripts/check-release-pipeline.sh --self-test
	@python3 scripts/check-version-lockstep.py --self-test
	@bash scripts/check-sigpipe-readers.sh --self-test
	@bash scripts/check-artifact-assertions.sh --self-test
	@bash scripts/check-shellcheck.sh --self-test
	@bash scripts/gitleaks-precommit.sh --self-test
	@python3 scripts/check-docs-internal-links.py --self-test
	@bash scripts/check-nul-bytes.sh --self-test
	@python3 scripts/check-cognitive-complexity.py --self-test
	@bash scripts/check-load-bearing.sh --self-test
	@node scripts/check-added-files-covered.mjs --self-test
	@node scripts/check-licenses.mjs --self-test
	@# The OSV severity gate is deliberately NOT mirrored here, or anywhere
	@# else in this Makefile, even though its --self-test is hermetic — see
	@# check-prepush-parity.sh's OPT_OUT entry for that gate: its REAL
	@# invocation needs an advisory-database lookup no commit can satisfy, and
	@# giving the self-test its own Makefile line would satisfy that other
	@# gate's text-match check for the wrong reason, hiding the real
	@# constraint behind a technicality. (Deliberately not spelling out its
	@# path here, for the same reason.) Run its self-test by hand instead —
	@# see the script's own header for the exact command.
	@bash scripts/tests/wt-args.test.sh
	@bash scripts/tests/wt-prune.test.sh
	@bash scripts/tests/wt-ports.test.sh
	@bash scripts/tests/wt-lock.test.sh
	@bash scripts/tests/pre-mr-security-gate.test.sh
	@bash scripts/tests/setup-hooks.test.sh
	@bash scripts/tests/app-fixture-gates.test.sh
	@# customize.sh/doctor.sh are onboarding checks, not CI gates — same bucket
	@# as the wt-*/setup-hooks tests above. See onboarding-customize-e2e in .github/workflows/governance.yml.
	@bash scripts/tests/customize-e2e.test.sh

release-pipeline-check:  ## Assert this commit's branch pipeline passed before a tag publishes
	@# NOT in pre-push-checks on purpose: its oracle is the forge API and it only
	@# has a question to answer inside a tag pipeline, where it gates the publish
	@# jobs. Run locally and it says so rather than guessing.
	@bash scripts/check-release-pipeline.sh

memory-check:  ## Check the Claude memory index for size and dangling links
	@# NOT in pre-push-checks on purpose: its input is a per-user directory outside
	@# the repo, so no commit can fix a failure. Run it at each release close,
	@# beside /memory-audit.
	@bash scripts/check-memory-index.sh

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
