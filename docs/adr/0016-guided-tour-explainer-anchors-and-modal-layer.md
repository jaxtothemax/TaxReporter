# 16. Guided tour: explainer anchors and the modal layer

**Date:** 2026-10-09
**Status:** Proposed

> **Implementation status (2026-10-09):** being built on branch `feat/27-guided-tour` (#27),
> not yet on `main`. Built so far: the tour's reducer (`apps/web/src/tour/machine.ts`) and
> the review's view held by the app frame (`ReviewView` in `apps/web/src/screens/ReviewStep.tsx`).

## Context

The demo is the start screen's primary call to action. Its owner wants a guided tour over
it: on each stop one card stays lit, the rest of the page is dimmed, and short explanations
beside the card, joined to the elements they explain by thin lines, say what each figure is
and where it came from (#27). A Voice of the Customer panel found the value in explaining
meaning and provenance (the Banka Slovenije rate and its list date, FIFO across brokers,
the holding period, the 30-day rule, the treaty-capped credit), not in pointing at buttons,
and set hard limits: a one-action exit that leaves no trace, never covering the figure being
explained, keyboard and screen-reader use, and no sideways scroll on a phone.

The app has no overlay, dialog or focus trap yet, so this is its first modal layer; the
opt-in AI check's consent dialog (ADR 0008) will need one too. It runs under a strict
Content Security Policy in the production build (`style-src 'self'`, no `'unsafe-inline'`),
which the dev server does not apply. It stores nothing (ADR 0002), not even the theme or
the language.

The owner decided (2026-10-09): the tour starts the first time the demo opens in a page
session, with a one-action exit; it drives the demo, showing screens, review tabs and open
rows of its choosing; it shows at most three explanations at once on a wide screen and one
at a time on a phone; and the demo data stays as it is (#26).

## Decision

1. **Built in-house, with no dependency.** No tour library surveyed shows several
   explanations per step with lines, makes the rest of the page inert, or drives tabs and
   rows and puts them back; several inject `<style>` elements, which the production CSP
   blocks, and two are licensed in ways that do not fit ADR 0010. The geometry is a small
   set of pure, tested functions.
2. **The tour is a view override, never a navigator.** Its state is a separate reducer
   (`tour/machine.ts`) held next to the wizard, not in it. While a stop runs, the app
   renders the stop's screen, review tab and open securities in place of the user's; the
   wizard's state is never changed. Exiting removes the override, so the user's screen,
   tab and rows come back by construction rather than by replaying a snapshot. The
   review's tab and open securities are held by the app frame (`ReviewView`) for this.
3. **One modal layer.** A single `<dialog>` opened with `showModal()` for the tour's
   lifetime: the top layer clears the sticky header, the rest of the page is inert, and
   Escape closes it natively. Its `close` event is the only way out: Skip, Escape and
   Finish all end there, and the restore (scroll positions, then focus) runs from it. While
   the tour runs it owns scroll and focus; the app's own move of focus to a new screen's
   heading waits.
4. **Elements are named by explainer anchors.** A screen marks each element an
   explanation can point at with a `data-explain` attribute from one typed helper
   (`explain/anchors.ts`). The name is `explain`, not `tour`: the same anchors are meant
   to carry "why" text on the user's own review later. Screens depend on the anchors
   only, never on the tour.
5. **Positions are measured and applied through CSSOM.** Boxes are placed by pure layout
   functions from measured rectangles and applied through React's `style` prop, which
   writes CSSOM properties that `style-src 'self'` allows. The dim, its cutout, the lines
   and the rings are one `aria-hidden` SVG whose geometry is in attributes. Inline `style`
   markup, `setAttribute("style")`, `cssText` and `<style>` elements are not used.
6. **Explanations are concepts in the message catalog, figures come from the preview.**
   Each explanation is a concept entry (`t.explain.*`) in Slovenian and English, written
   descriptively ("here", "this sale"); demo framing lives only in the tour's own intros.
   Every figure shown is a field of the demo's preview model, formatted as the screen
   formats it; any equation the text states is checked in a test with the project's
   decimal type. A rule the text states points to its `docs/research/` section; the tour
   describes what the engine did and states no new rule.
7. **Demo only, in memory.** The tour runs only on the demo. Whether it has run lives in
   memory for the page session; nothing is stored (ADR 0002), so a new page session starts
   it again.

## Consequences

- **Every screen keeps its anchors.** A test renders each stop and fails when an anchor it
  points at is missing, so a screen change cannot silently break the tour.
- **Returning visitors see the tour again** in a new page session, since nothing is stored.
- **The language switch is out of reach while the tour runs**, as the page behind the
  dialog is inert.
- **The CSP holds only if the rules in decision 5 are kept;** a grep test enforces them,
  and the tour is checked on the production build, not the dev server.
- **The modal layer is reusable** for the AI check's consent dialog (ADR 0008).
- **Browser tests become part of CI.** What only a browser shows (the modal layer,
  focus, restore, a phone's width, the CSP) is tested with Playwright, a development
  dependency pinned to an exact version, against the production build in Chromium,
  Firefox and WebKit. The CI job runs in Microsoft's Playwright image pinned by digest,
  because `playwright install` verifies no hash of the browsers it downloads. The tests
  stay out of `pre-push-checks` (`make test-e2e`), so a contributor without the browsers
  can still push. Playwright bundles third-party libraries that no lockfile scan sees;
  a few carried advisories at 1.64.0 (none reachable from these tests), so each bump
  re-checks that bundle.
- **Removing the tour is cheap:** the tour module, the override in the app frame and the
  banner action. The anchors, the review's view and the explanations stay useful.

Alternatives considered: a tour library (decision 1); driving the wizard and restoring a
snapshot, which loses the user's tab and rows when the screen changes; a non-modal panel
with `inert` set by hand, kept as a fallback should a browser's `showModal` misbehave;
element ids or React refs as anchors, which already carry ARIA wiring or would thread the
tour through every screen; CSS anchor positioning, too new and unable to draw a line
between two boxes; and remembering dismissal in `sessionStorage`, which ADR 0002 rules out.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0016`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
