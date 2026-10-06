# ─── Project Template Makefile ────────────────────────────────────────────────
#
# Canonical command interface. Every project speaks the same language:
#   make setup    — first-time setup (install hooks, dependencies)
#   make lint     — run linters (define per-stack targets below)
#   make test     — run test suite
#   make build    — build artifacts
#   make doctor   — check prerequisites and environment
#
# Stack-specific targets go in the sections below. Uncomment and customize
# the blocks that match your stack.

.PHONY: setup lint format format-check typecheck test build doctor customize clean pre-push-checks check-collision check-selftest-parity check-version-lockstep release-pipeline-check gitleaks-check check-nul-bytes check-compose check-complexity

# ─── Universal targets ────────────────────────────────────────────────────────

setup: install-hooks  ## First-time project setup (install hooks)
	@echo "Setup complete. Run 'make customize' to check template configuration."

customize:  ## Check and guide template customization (run after cloning)
	@bash scripts/customize.sh

install-hooks:
	@scripts/setup-hooks.sh

doctor:  ## Check prerequisites and environment health
	@scripts/doctor.sh

lint:  ## Run linters — customize per stack
	@echo "ERROR: 'make lint' is not configured. Edit Makefile to add your linter." && exit 1

format-check:  ## Check formatting without writing — customize per stack (used by the pre-commit hook)
	@echo "ERROR: 'make format-check' is not configured. Edit Makefile to add your formatter." && exit 1

format:  ## Auto-fix formatting — customize per stack
	@echo "ERROR: 'make format' is not configured. Edit Makefile to add your formatter." && exit 1

typecheck:  ## Run type checker — customize per stack (tsc, mypy, go vet, etc.)
	@echo "ERROR: 'make typecheck' is not configured. Edit Makefile to add your type checker." && exit 1

test:  ## Run test suite — customize per stack
	@echo "ERROR: 'make test' is not configured. Edit Makefile to add your test runner." && exit 1

build:  ## Build artifacts — customize per stack
	@echo "ERROR: 'make build' is not configured. Edit Makefile to add your build command." && exit 1

clean:  ## Remove build artifacts
	@echo "Nothing to clean (customize this target for your stack)."

# ─── Python (uncomment if using Python) ──────────────────────────────────────
#
# lint:
# 	ruff check .
#
# test:
# 	pytest --tb=short -q
#
# build:
# 	docker compose build

# ─── Node.js (uncomment if using Node.js) ────────────────────────────────────
#
# lint:
# 	cd frontend && npm run lint
#
# test:
# 	cd frontend && npm test
#
# build:
# 	cd frontend && npm run build

# ─── Go (uncomment if using Go) ──────────────────────────────────────────────
#
# lint:
# 	golangci-lint run ./...
#
# test:
# 	go test ./... -v
#
# build:
# 	go build -o bin/app ./cmd/app

# ─── Multi-stack (uncomment if using multiple stacks) ────────────────────────
#
# lint: lint-backend lint-frontend
# lint-backend:
# 	ruff check backend/
# lint-frontend:
# 	cd frontend && npm run lint
#
# test: test-backend test-frontend
# test-backend:
# 	cd backend && pytest --tb=short -q
# test-frontend:
# 	cd frontend && npm test

# ONE PREREQUISITE PER LINE. Make accumulates prerequisites across repeated rule
# lines, so this is the same target as one long line. It is split because every new
# gate is registered here: on a single line, any two branches that each add a gate
# conflict on it. Add each project check (migrations, schema drift, generated-file
# freshness) as its own `pre-push-checks: <target>` line, in the order it should run.
#
# NO RECIPE on any of these lines, and keep it that way. On GNU Make 3.81 (the macOS
# default), giving one of them a recipe while the others carry the prerequisites
# reorders the merged list — `a b c` ran as `b c a`, which would move
# check-collision from first to last. Recipe-less lines keep their written order.
pre-push-checks:  ## Full-codebase checks run before push (override per project)
pre-push-checks: check-collision
pre-push-checks: check-migration-numbering
pre-push-checks: check-parity
pre-push-checks: check-selftest-parity
pre-push-checks: check-version-lockstep
pre-push-checks: check-sigpipe
pre-push-checks: check-artifact-asserts
pre-push-checks: check-shellcheck
pre-push-checks: check-docs-links
pre-push-checks: check-ws-reachability
pre-push-checks: check-nul-bytes
pre-push-checks: check-compose
pre-push-checks: check-load-bearing
pre-push-checks: check-ts-parity
pre-push-checks: check-added-files-covered
pre-push-checks: check-app-fixture-gates

check-collision:  ## Block a push that would open a duplicate MR for an issue
	@# Runs FIRST, before the slower code gates: finding out you duplicated
	@# another session's issue is cheapest before the lint/typecheck minutes.
	@bash scripts/check-issue-collision.sh

check-migration-numbering:  ## Block a push whose new migration collides with origin/main's numbering
	@# Runs early, alongside check-collision — both compare against a freshly-fetched
	@# origin, and both are cheapest to find out about before the lint/typecheck
	@# minutes. See scripts/check-migration-numbering.sh's own header: this is what
	@# makes the gate fire on REBASE (every push re-diffs against the latest
	@# origin/main), not only at merge time. A repo with no migrations/ directory
	@# anywhere passes trivially.
	@bash scripts/check-migration-numbering.sh

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

check-ws-reachability:  ## Published real-time event taxonomy names only reachable events (skips if no doc)
	@# Mirrors ci/python.yml's `exists:` gate on WS_DOC_FILE — no taxonomy doc in
	@# this clone is a "skip", not a failure, the same shape check-docs-links
	@# above uses. WS_UNREACHABLE_CLASS_PATTERN / WS_ROUTE_EXISTS_PATTERN are
	@# inert by default (match nothing) until a project wires its own
	@# broadcast/reachability patterns — see
	@# scripts/check-ws-event-reachability.py's own header.
	@if [ -f "$${WS_DOC_FILE:-docs/websockets.md}" ]; then \
		python3 scripts/check-ws-event-reachability.py \
			--source-dir "$${WS_SOURCE_DIR:-backend}" \
			--routing-file "$${WS_ROUTING_FILE:-backend/routing.py}" \
			--doc-file "$${WS_DOC_FILE:-docs/websockets.md}" \
			--unreachable-class-pattern "$${WS_UNREACHABLE_CLASS_PATTERN:-(?!)}" \
			--route-exists-pattern "$${WS_ROUTE_EXISTS_PATTERN:-(?!)}"; \
	else \
		echo "No real-time event taxonomy doc detected ($${WS_DOC_FILE:-docs/websockets.md} not found) — skipping check-ws-reachability."; \
	fi

check-nul-bytes:  ## No tracked text=set file contains a literal 0x00 byte
	@# In pre-push-checks because it is repo-only and fast (one python3 pass
	@# over the whole index). A NUL makes git classify the file BINARY, which
	@# defeats every other grep-based gate on it silently — catching it here
	@# is cheaper than debugging a false-clean scan later.
	@bash scripts/check-nul-bytes.sh

check-compose:  ## Every standalone docker-compose file pins its own project name:
	@# In pre-push-checks because it is repo-only and fast. This template ships
	@# no compose files of its own, and a consuming project without Docker must
	@# not fail a check for a file class it will never have — the script itself
	@# passes with nothing scanned when no compose file exists (same
	@# skip-when-absent shape as check-shellcheck above, applied inside the
	@# script rather than by a missing local tool).
	@bash scripts/check-compose-project-names.sh

check-added-files-covered:  ## Every added source file appears in its coverage report (skips if node is absent)
	@# Skips (does not fail) when `node` is not installed locally — same shape as
	@# check-shellcheck's absent-tool skip, so a Python-only clone with no Node
	@# toolchain at all is never broken by this target. CI's added-files-covered
	@# job always has node (its own image is node:20-alpine); this is a
	@# local-dev convenience only. Each configured "layer" (see
	@# scripts/check-added-files-covered.mjs) skips on its own if that layer's
	@# directory has no added files or its coverage report doesn't exist yet.
	@if command -v node >/dev/null 2>&1; then \
		node scripts/check-added-files-covered.mjs; \
	else \
		echo "node not installed — skipping check-added-files-covered."; \
	fi

check-app-fixture-gates:  ## Application-aware gates pass a real app fixture and reject seeded drift (#52)
	@# Blueprint's own tree has no backend/ or frontend/, so the four gates that
	@# read application code skip on it. This runs them against an app fixture
	@# generated into a temp dir — see scripts/tests/app-fixture-gates.test.sh.
	@# Needs python3 and node; skips (does not fail) without node, the same
	@# absent-tool shape as check-added-files-covered. CI's app-fixture-gates
	@# job always has both.
	@if command -v node >/dev/null 2>&1; then \
		bash scripts/tests/app-fixture-gates.test.sh; \
	else \
		echo "node not installed — skipping check-app-fixture-gates."; \
	fi

check-ts-parity:  ## Backend schema and TypeScript interfaces agree (skips if no schema/types)
	@# Mirrors ci/python.yml's `exists:` gate on TS_PARITY_SCHEMA — no OpenAPI
	@# document in this clone is a "skip", not a failure, same shape as
	@# check-docs-links/check-ws-reachability above. The script itself further
	@# skips cleanly if TS_PARITY_TYPES is also missing (a Python-only clone
	@# with no TypeScript frontend). See
	@# scripts/check-serializer-ts-parity.py's own header for the
	@# --component-map override.
	@if [ -f "$${TS_PARITY_SCHEMA:-docs/api/openapi.json}" ]; then \
		python3 scripts/check-serializer-ts-parity.py \
			--schema "$${TS_PARITY_SCHEMA:-docs/api/openapi.json}" \
			--types "$${TS_PARITY_TYPES:-frontend/src/types/index.ts}"; \
	else \
		echo "No OpenAPI schema detected ($${TS_PARITY_SCHEMA:-docs/api/openapi.json} not found) — skipping check-ts-parity."; \
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
	@# without choosing it. Unlike helm-drill above, it CAN run offline in
	@# seconds (no external oracle, no build artifact) — that disqualifies it
	@# from OPT_OUT in check-prepush-parity.sh, which is reserved for gates that
	@# genuinely cannot run locally, not gates a project has not opted into. A
	@# project that DOES opt in should fold this into its own pre-push-checks.
	@python3 scripts/check-cognitive-complexity.py

helm-drill:  ## Run the Helm install/upgrade drill locally (needs docker, kind, kubectl, helm on PATH)
	@# NOT in pre-push-checks: needs a live Docker daemon and a real kind
	@# cluster — minutes, not seconds — and most template clones have no Helm
	@# chart at all (scripts/helm-install-drill.sh exits 2 immediately if
	@# $$HELM_CHART_DIR/Chart.yaml is absent; see ci/helm.yml). Set
	@# DRILL_LEG=upgrade to run the upgrade leg instead of the default install.
	@CHART_DIR="$${HELM_CHART_DIR:-helm}" bash scripts/helm-install-drill.sh

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
	@bash scripts/check-migration-numbering.sh --self-test
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
	@python3 scripts/check-ws-event-reachability.py --self-test
	@bash scripts/check-nul-bytes.sh --self-test
	@bash scripts/check-compose-project-names.sh --self-test
	@python3 scripts/check-cognitive-complexity.py --self-test
	@bash scripts/check-load-bearing.sh --self-test
	@python3 scripts/check-serializer-ts-parity.py --self-test
	@node scripts/check-added-files-covered.mjs --self-test
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
	@bash scripts/tests/helm-upgrade-leg-version.test.sh
	@bash scripts/tests/setup-hooks.test.sh
	@bash scripts/tests/app-fixture-gates.test.sh
	@# customize.sh/doctor.sh are onboarding checks, not CI gates — same bucket
	@# as the wt-*/setup-hooks tests above. See ci-onboarding-e2e in .gitlab-ci.yml.
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
