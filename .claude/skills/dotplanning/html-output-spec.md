# Dotplanning — HTML Report Template

Read this file from `SKILL.md` Step 8, before writing the report file. It holds the
required section list, the severity palette, and the CSS guidance for the
self-contained HTML report. See `SKILL.md` Step 8 for the surrounding procedure:
the output path, getting the date, writing the file with the `Write` tool, and the
chat summary printed afterward.

Required sections, in order:

1. **Header** — `<PROJECT> — <VERSION> Milestone Plan`, generation date, last-shipped
   version, and a "Planning gate" badge.
2. **Scope summary** — the themes verbatim, count of tracked issues, count of inherited
   deferred findings.
3. **Release shape** — every Step 2 answer, verbatim, including the ones the user
   declined and the assumption you proceeded on. This is the section someone re-reads
   in week six to find out what was actually agreed.
4. **Feature → asset matrix** — one table; rows = features, columns = the asset classes
   from Step 3, cells = 🟢/🟡/🔴 with a one-line note. The centerpiece.
5. **Missing assets (🔴)** — ranked, screens/flows first, each with what's missing and
   the cheapest way to close it.
6. **Open questions** — the Step 5 list, ranked, each as a decision with options +
   recommendation.
7. **Sequenced plan** — the Step 4 workstreams in order, each with its gate chain.
8. **Commitment ledger** — the full Step 6 table, one row per issue (issue, current
   value, proposed value, the rule that fired), plus the fit numbers and every issue
   left undecided. Values are the GitHub label names (`release:committed`,
   `release:reserve`, `release:stretch`). GitHub does not enforce exclusivity, so an
   issue holding two `release:*` labels shows **every** label it holds in the current
   column, flagged 🔴 — never just the first one.
9. **Delight wedge** — the single Step 7 idea (or "none in scope this cycle").
10. **Appendix — inputs reviewed** — spec/roadmap source, issue ids pulled, persona file,
    throughput window measured, code anchors surveyed. So the plan is auditable.

Use a legible severity palette so it reads at a glance:
- 🔴 missing / blocking → `#b42318` (red)
- 🟡 planned / should-decide → `#b54708` (amber)
- 🟢 exists / ready → `#067647` (green)

**Issue references.** Render every issue number as a link to
`https://github.com/<owner>/<repo>/issues/<N>`, taking `<owner>/<repo>` from
`gh repo view --json nameWithOwner -q .nameWithOwner` at report time — never hardcoded.
With no GitHub repo yet (the no-tracker case in `SKILL.md`), render plain `#N` text and
say so in the header. Links are fine; what must not exist is a fetched asset.

Keep the CSS minimal (system font stack, max-width ~960px, light background, generous
padding). The file must open correctly by double-click with no network access.
