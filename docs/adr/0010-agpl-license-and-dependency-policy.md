# 10. License under AGPL-3.0-or-later and admit only compatible dependencies

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

## Context

The project is meant for the community. Commercial Slovenian services already charge for the
same job. Research found that several existing tools are unlicensed or under non-commercial
licenses (brrr-generator: CC BY-NC-SA; revolut-edavki: custom non-commercial), so their code
cannot be reused. The owner chose AGPL-3.0 so that anyone who offers a modified version as a
hosted service must publish their changes.

## Decision

- **License.** TaxReporter is licensed **AGPL-3.0-or-later**; `LICENSE` holds the full text.
- **Compatible dependencies only.** Allowed: permissive licenses (MIT, ISC, BSD, Apache-2.0,
  0BSD, CC0, CC-BY-4.0, Unlicense, BlueOak, Python-2.0) and compatible copyleft (LGPL, MPL-2.0,
  GPL-2.0-or-later, GPL-3.0, AGPL-3.0).
  Not allowed: GPL-2.0-only, SSPL, BUSL, Commons Clause, non-commercial licenses, proprietary
  or unknown licenses.
- **Fonts are the one OFL exception.** Font packages under SIL OFL-1.1 are allowed by name in
  the license gate's reasoned-exceptions table. Fonts are separate works served as assets, and
  OFL-1.1 permits bundling them with any software. OFL code packages are not allowed.
- **Enforced twice.** The `dependency` agent checks before a package is added, and a CI
  license gate checks the installed tree.
- **No copying from non-compatible projects.** Code is never copied from them. MIT-licensed
  data from ib-edavki may be reused with attribution.
- **Data attribution.** Banka Slovenije, ECB and FURS data keep their source attribution
  (ADR 0005).

## Consequences

- **The tool stays open.** Hosted forks must share their changes.
- **Some organizations avoid AGPL code.** That is an accepted cost; the tool is aimed at
  individuals and accountants, not at embedding.
- **License changes are hard.** Relicensing later would need the consent of every
  contributor, so the choice is effectively permanent.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
