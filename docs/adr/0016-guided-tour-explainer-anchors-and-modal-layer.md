# 16. Guided tour: explainer anchors and the modal layer

**Date:** 2026-10-09
**Status:** Proposed

> **Implementation status (2026-10-10):** the decision is still Proposed, but its
> implementation lands with it in the pull request for #27, not as a later step:
> `apps/web/src/explain/anchors.ts`, `apps/web/src/tour/` (`machine.ts`, `layout.ts`,
> `script.ts`, `TourLayer.tsx`), the anchors on the five screens, the review's view held by
> the app frame (`ReviewView`), and the browser tests in `apps/web/e2e/tour.spec.ts`.
> Accepting it changes no code.

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
   While the tour runs the page gets room below its end (`.app.is-touring`), so a card
   near the end of a short screen can still be scrolled clear of the dock; the room goes
   when the tour does, before the scroll is given back.
3. **One modal layer.** A single `<dialog>` opened with `showModal()` for the tour's
   lifetime: the top layer clears the sticky header, the rest of the page is inert, and
   Escape closes it natively. Its `close` event is the only way out: Skip, Escape and
   Finish all end there, and the restore (scroll positions, then focus) runs from it. While
   the tour runs it owns scroll and focus; the app's own move of focus to a new screen's
   heading waits (WebKit lets that focus land behind the modal, then drops it to the body).
   When the dialog opens, Next has focus (`autofocus`), so Enter goes on; Skip is first in
   the DOM and Tab order. Focus goes back to a named element, never to whatever had it: the
   heading of the screen the demo opened on, or the button that started the tour where the
   page still shows it (the banner's replay, or "Use demo files" with the scroll the user
   left), since WebKit does not focus a button on a click. That element is focused just
   before the dialog opens, because WebKit gives focus back to it on close after the app's
   own restore. The tab title keeps following the user's screen, not the stop shown.
4. **Elements are named by explainer anchors.** A screen marks each element an
   explanation can point at with a `data-explain` attribute from one typed helper
   (`explain/anchors.ts`). The name is `explain`, not `tour`: the same anchors are meant
   to carry "why" text on the user's own review later. Screens depend on the anchors
   only, never on the tour.
5. **Positions are measured and applied through CSSOM.** Boxes are placed by pure layout
   functions from measured rectangles and applied through React's `style` prop, which
   writes CSSOM properties that `style-src 'self'` allows. The dim, its cutout, the lines
   and the rings are one `aria-hidden` SVG whose geometry is in attributes. Inline `style`
   markup, `setAttribute("style")`, `cssText` and `<style>` elements are not used. A line
   joins an explanation to its target only where the whole target is in view; a target cut
   off by the window or its table gets its explanation with no line. In the one-at-a-time
   sheet the ring marks whatever part of the target shows, because a short window can leave
   less room above the sheet than the target needs.
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
  can still push. Playwright bundles third-party libraries that no lockfile scan sees.
  At 1.64.0 four carried advisories, none reachable from these tests: brace-expansion
  5.0.7 (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-qhr7-859c-m2p7,
  GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr), @modelcontextprotocol/sdk 1.29.0
  (GHSA-6qxp-vccf-f47h), @hono/node-server 1.19.14 (GHSA-frvp-7c67-39w9) and fast-uri
  3.1.7 (GHSA-hrr3-gc8f-f4qj). No scanner reads that bundle, so a bump re-checks it
  against OSV by hand, as the comment beside the `playwright` group in
  `.github/dependabot.yml` says. The report a failed run uploads carries no git
  details (`captureGitInfo` off).
- **The tour fails safe.** It sits in its own error boundary, which ends the tour and
  gives the page back; leaving demo mode ends it too; a stop whose card never appears
  says so instead of waiting; and anchors are found by name with their keys compared
  as text, never parsed, since keys will come from the user's own files.
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
