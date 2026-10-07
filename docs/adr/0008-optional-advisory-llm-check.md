# 8. Offer an optional, advisory, bring-your-own-key LLM check

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** decided during project setup; nothing ships with
> this ADR yet beyond the package skeleton. Remove this note when the first implementation
> merges.

## Context

The owner wants parsing and calculation to be deterministic, with an LLM available as an
optional extra check. An LLM can usefully read a summary and point out what looks odd: a sale
with no matching purchase history, an implausible withholding rate for a country, a currency
that does not match the ISIN's exchange. But it is not reproducible and must not decide
figures that go into a tax return. Sending data to an LLM provider is the only network
egress that involves user data (ADR 0002).

## Decision

- **Off by default, always optional.** The tool is fully functional without it.
- **Bring your own key.** The user supplies their own API key at runtime. The CLI reads an
  environment variable. The browser keeps the key in memory, or in local storage only if the
  user explicitly opts in. The project ships no key and no proxy.
- **Redacted payload, shown first.** The app builds a redacted payload: per-security
  aggregates, holding periods, rates used and diagnostics. It never includes the tax number,
  name, address, account or order IDs. The exact payload is shown before sending, and nothing
  is sent without the user confirming.
- **Advisory findings only.** The model answers with structured findings validated against a
  schema. Findings appear as warnings next to the deterministic results and **never change a
  computed value or the generated XML**.
- **Provider adapters.** The integration sits behind a small interface. The first adapter
  targets the Anthropic Messages API with a current Claude model; others can be added.

## Consequences

- **Sanity-checking without a trust problem.** Users get a second look at their data without
  any figure depending on a model.
- **Strict separation in code.** The LLM package may read the redacted summary but cannot
  import the form writers.
- **The browser adapter needs care.** Calling the provider directly from the browser requires
  its CORS opt-in header, and the Content Security Policy must allow exactly that one origin.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
