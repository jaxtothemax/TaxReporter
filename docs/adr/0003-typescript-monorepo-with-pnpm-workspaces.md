# 3. Build TaxReporter as a TypeScript monorepo

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** decided during project setup; nothing ships with
> this ADR yet beyond the package skeleton. Remove this note when the first implementation
> merges.

## Context

ADR 0002 requires the same logic to run in a browser (for non-technical users) and on the
command line (for power users, accountants and CI). The ecosystem's reference tool,
ib-edavki, is Python, but Python in the browser means shipping a Pyodide runtime of tens of
megabytes. Contributors adding broker adapters (persona Tadej) need a language most
developers already read, plus fast local tests. The Blueprint harness drives everything
through `make lint/typecheck/test/build`, so the stack must slot into those targets.

## Decision

- **Language:** TypeScript in strict mode, ESM only, on Node 24 LTS.
- **Workspace:** a pnpm monorepo:

| Package | Responsibility |
|---|---|
| `packages/core` | Normalized ledger model, decimal money, FIFO lot engine, holding periods, diagnostics |
| `packages/fx` | Banka Slovenije rate snapshot, lookup and provenance (ADR 0005) |
| `packages/furs` | FURS form builders, schema-ordered XML writers, business-rule validation, vendored XSDs (ADR 0007) |
| `packages/brokers` | Broker adapters and format detection (ADR 0004) |
| `apps/cli` | Node command-line interface |
| `apps/web` | React + Vite static single-page app |

- **Tooling:** Vitest for tests, ESLint and Prettier, and `tsc` project references for type
  checking. The `make` targets call them so hooks, CI and agents agree on what "passes" means.
- **Dependency direction:** packages depend inward only: brokers → core, furs → core + fx,
  apps → everything. `core` has no I/O.

## Consequences

- **One codebase serves both apps.** The browser and the CLI share every rule, so a fix lands
  in both at once.
- **Most testing needs no browser.** Pure-function packages are tested in Node. Only `apps/web`
  needs browser testing.
- **No Python code from ib-edavki can be reused.** Its MIT-licensed data, such as dividend-payer
  metadata, can be reused with attribution.
- **pnpm is required.** Contributors need pnpm installed, and `make doctor` checks for it.
- **Native-only libraries are out.** Libraries that work only in Node with native bindings are
  excluded by design.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
