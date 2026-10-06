# Dotplanning — Kickoff Questions

Read this file from `SKILL.md` Step 2, before asking any kickoff question. It holds
the twelve questions grouped into the three `AskUserQuestion` calls — ask them
exactly as written here. See `SKILL.md` Step 2 for the procedure around them: four
questions per call, filling options from the Step 1 inputs, marking the
evidence-backed value `(Recommended)`, and skipping any question the user's
invocation already answered.

**Call 1 — Shape**

1. **Charter.** Which theme or themes is this release *named for* — the set where, if it
   does not ship, the release has not happened? Options: the headliners as written in 1a,
   a narrower single one, or other.
2. **Headliner count.** Single headliner, or co-headline? Co-headlining multiplies
   delivery risk, and a co-headliner added mid-cycle rarely displaces anything.
   Recommend single unless both share one seam that cannot ship half-built.
3. **Date or scope.** When the committed set does not fit, which gives — the date slips,
   or committed issues get demoted? `release::committed` is defined as "ships or the
   release slips"; confirm the user means that literally for this release.
4. **Promised maturity.** What does reaching this milestone mean — alpha, beta, rc,
   stable? This is not cosmetic. If the project's docs carry "ships in `$VERSION`"
   callouts or a roadmap that moves a version into "shipped", the answer decides when
   those flip, and flipping them early publishes unshipped work as available.

**Call 2 — Capacity**

5. **Capacity.** How many issues can close in the `$VERSION` window? Offer the 1f
   measurement, and the same number adjusted for this milestone's feature/hardening mix.
6. **Inbound reserve.** How many slots stay unallocated for reports from real users?
   Derive a candidate from the rate of inbound since `$SHIPPED`. The reserve is a
   **number written on the milestone**, not a sentiment.
7. **Feature freeze.** On what date do `release::stretch` issues bulk-move out? Recommend
   the date of the first `/pre-release full` run.
8. **Hardening share.** What fraction of committed capacity goes to debt, hardening, and
   CI, versus charter features?

**Call 3 — Risk**

9. **Carry-over.** The issues still open in the previous milestone (1g): do they move
   into `$VERSION`, and are they groomed like everything else? Recommend: move, then
   groom — never inherit a `release::committed`, because that promise was sized against
   a different capacity.
10. **Credibility prerequisites.** Which open issues undercut a claim the product already
    makes in public — a published limit, a doc page, a demo? Offer the ones you found,
    and recommend committing these ahead of new features.
11. **Unvalidated foundations.** Which candidates build depth on a surface no real user
    has exercised yet? Recommend stretch unless the user has real signal for the
    foundation underneath.
12. **Cut line.** Past what date is a committed issue that is not on track demoted to
    stretch rather than slipping the release? Recommend a date (e.g. two weeks before
    freeze). "Never — slip instead" is a valid answer if Q3 said the date slips.
