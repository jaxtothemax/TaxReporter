# 2. Process everything on the user's device

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** decided during project setup; nothing ships with
> this ADR yet beyond the package skeleton. Remove this note when the first implementation
> merges.

## Context

Broker exports contain a person's complete trading history, account identifiers and, once
merged with the filing header, their tax number and address. Today's free Slovenian services
(Davkomat, DavekNaDobiček) process these files on their servers, and paid ones ask users to
upload statements or send them by email. Research found no technical reason for a server: the
inputs are files the user already has, the exchange rates are public data, and the output is
a file the user imports into eDavki themselves (`docs/research/05-prior-art.md`).

Accountants filing for clients (persona Mojca) take on GDPR processor obligations as soon as
client data reaches a third party. Beginners (persona Maja) say outright that uploading
financial statements feels wrong.

## Decision

TaxReporter has **no backend**. All parsing, conversion, lot matching and XML generation runs
in the user's browser (static web app) or on their machine (CLI).

- There are no accounts, no telemetry and no analytics.
- The only network requests the app may make are:
  - downloading the project's own published exchange-rate snapshot, which contains no user data;
  - the opt-in LLM check described in ADR 0008.
- Parsers never touch the network.
- Session state stays in memory unless the user explicitly saves a file.

## Consequences

- **Privacy is structural.** It is guaranteed by the architecture, not promised in a policy,
  and the README can say so plainly.
- **Nothing to run.** There is no hosting cost, no server to secure and no personal data to
  breach. The project can be published on GitHub Pages (ADR 0009).
- **Data and libraries must work offline.** Rates ship as a bundled snapshot (ADR 0005),
  and every library must run in the browser as well as Node. That rules out native modules
  and anything that needs a server-side XSD validator at runtime.
- **No server-side safety net.** There are no crash reports from real use. Bugs surface only
  through user reports, so diagnostics must be explicit and copyable without exposing
  personal data.
- **Big imports must stay responsive.** Large IBKR files are parsed in a Web Worker to keep
  the UI responsive.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
