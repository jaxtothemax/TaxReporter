# TaxReporter web app — UI conventions

The design system the `ux-design`, `ux-review` and `accessibility` agents check against.
The tokens live at the top of `src/styles.css`; the components in `src/ui/kit.tsx` and
`src/ui/charts.tsx`. Dark is the default theme and light is finished to the same standard:
every rule below holds in both.

---

## Color tokens

One accent (emerald). Status colors carry meaning and are used for nothing else.

| Token                                                                     | Usage                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--surface-hover`      | Page, cards, nested panels, fills, hover                                                     |
| `--border`, `--border-strong`                                             | Hairlines and stronger separators (decorative, not component boundaries)                     |
| `--field-border`                                                          | The boundary of an input: 3:1 against the card                                               |
| `--text`, `--text-2`, `--text-3`                                          | Primary, secondary, tertiary text (all pass 4.5:1 on every surface)                          |
| `--accent`, `--accent-hover`, `--on-accent`                               | Primary button fill and its label                                                            |
| `--accent-text`, `--accent-soft`, `--accent-line`                         | Emerald text, tinted fill, tinted border                                                     |
| `--loss`, `--loss-soft`                                                   | Signed amounts below zero only                                                               |
| `--danger`, `--danger-soft`, `--danger-line`                              | Errors and blocking states                                                                   |
| `--warn`, `--warn-text`, `--warn-soft`, `--warn-line`                     | Warnings and the demo banner                                                                 |
| `--focus`                                                                 | Every focus ring                                                                             |
| `--seg-active`, `--on-seg-active`                                         | The inverted selected segment of a pill control (tabs, language)                             |
| `--chart-0` … `--chart-3`                                                 | Data fills; never text                                                                       |
| `--tour-dim`, `--tour-frame`, `--tour-line`, `--tour-halo`, `--tour-ring` | The guided tour's overlay only: dim, frame round the lit card, lines and their casing, rings |

- Never write a raw color in a component rule. Add a token to both theme blocks.
- `--loss` is for money, `--danger` for errors: do not swap them.
- Ticker tiles take their hue from the symbol, inside a cyan-to-violet band (`hueOf`,
  `TICKER_HUES`) that avoids amber, emerald and rose, so a tile never reads as a status.

## Typography

Geist Variable for text, Geist Mono for identifiers (tickers, ISINs, file names, form codes).
Figures use `font-variant-numeric: tabular-nums` (`.num`).

| Token       | Size | Use                                                                     |
| ----------- | ---- | ----------------------------------------------------------------------- |
| `--fs-xs`   | 12px | Captions, table heads, chips. **The floor for anything informational.** |
| `--fs-sm`   | 13px | Secondary lines, legends                                                |
| `--fs-md`   | 14px | Controls, tables, notes                                                 |
| `--fs-base` | 15px | Body                                                                    |
| `--fs-lg`   | 16px | Leads, card titles, inputs (iOS zooms below 16px)                       |
| `--fs-xl`   | 18px | Section titles inside cards                                             |
| `--fs-2xl`  | 22px | Feature card titles                                                     |

Weights: `--fw-regular` 400, `--fw-medium` 550, `--fw-semibold` 600, `--fw-bold` 650.
Headings and headline amounts use `clamp()` sizes; `.amount-lg` and `.amount-xl` size to
their card (`cqi`), so a seven-figure sum fits a phone. Only the decorative ticker tiles go
below 12px.

## Shape and spacing

- Radii: `--r-xs` 4, `--r-sm` 8, `--r-md` 12, `--r-lg` 16, `--r-xl` 20, `--r-pill`. No other
  values.
- Card padding: `--card-pad` (24px), `--card-pad-lg` (28px) for feature cards.
- Breakpoints: 560px (phones), 720px (small tablets), 1024px (desktop). No others.

## Components (use these, do not hand-roll)

| Need                          | Use                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any button                    | `Button` (`primary` / `secondary` / `ghost`, `sm` / `md` / `lg`). One primary per area.                                                                                                       |
| Icon-only button              | `IconButton` (label required; it is also the tooltip)                                                                                                                                         |
| Short label or status pill    | `Chip` (`neutral` / `accent` / `warn`; `sm` in rows, `md` on its own line, icon first). In a flex column, wrap it in a `<p>` so it does not stretch.                                          |
| Gain or loss                  | `DeltaPill` (sign and arrow, not color alone)                                                                                                                                                 |
| Headline euro amount          | `Amount` (muted cents; one string for screen readers)                                                                                                                                         |
| Callout                       | `Note` (`neutral` / `warn` / `danger`, optional `action`). The only callout recipe.                                                                                                           |
| Table                         | `DataTable` (caption, named focusable scroll region)                                                                                                                                          |
| Tabs                          | `Tabs` (WAI-ARIA, roving tabindex; all panels rendered, inactive ones `hidden`)                                                                                                               |
| Security or payer mark        | `Ticker` (`labelled` where the symbol is not written next to it)                                                                                                                              |
| Icon in a tile                | `.icon-tile` with `-sm` / `-lg` and `.is-danger`                                                                                                                                              |
| Charts                        | `StackBar`, `MonthBars`, `CompareBars`: bars are `aria-hidden`, every figure is in text                                                                                                       |
| Overlay over the page         | The guided tour's `<dialog>` (`src/tour/TourLayer.tsx`), the app's only modal layer: `showModal()`, its `close` event the one way out. Reuse it for the AI check's consent dialog (ADR 0008). |
| Explanation beside an element | `.tour-note`, in the tour's overlay only. An in-flow callout stays `Note`.                                                                                                                    |

An action that is not available yet uses `aria-disabled` and an `aria-describedby`
explanation, not `disabled`, so keyboard users can reach it and hear why.

## Explainer anchors and the guided tour (ADR 0016)

- An element an explanation points at carries `explain(name, key?)` from
  `src/explain/anchors.ts` (the kit's `Chip`, `DeltaPill`, `Note` and `DataTable` take an
  `explain` prop). Never find a tour target by class or id. A repeated element is keyed
  (a security by ISIN, a row by kind and date). `src/tour/tour.test.tsx` fails when an
  anchor a stop names is missing from the screen it shows.
- Positions reach the page only through React's `style` prop or a CSSOM property write.
  Never a style attribute in markup, `setAttribute("style")`, `cssText` or a `<style>`
  element: the production CSP (`style-src 'self'`) blocks them, and the same test greps
  the app for them. A fixed container holding fixed children takes no `transform`,
  `filter` or `backdrop-filter`, which would make it their containing block.
- Measure only after the `.screen` / `.tab-panel` entrance animation has finished.
- The tour's cutout is the one shape outside the radius scale: concentric with the lit
  card, its radius is the card's own (capped at `--r-lg`) plus the padding around it.
- The tour's dock never grows past the window: it scrolls inside itself, and in the
  one-at-a-time sheet its controls row stays pinned and carries the bottom padding. The
  sheet is capped at `56dvh` at every width, so a short landscape window keeps room above
  it for the highlight.
  Explanation boxes stay between the sticky header and the dock.
- Tour motion: 160, 200 and 240ms fades, a 220ms progress transition and two 900ms ring
  pulses, all inside `prefers-reduced-motion: no-preference`. In forced-colors mode the
  tour draws no dim: a `Highlight` frame and `CanvasText` lines and rings.

## Focus

- Rings follow `:focus-visible`: always for the keyboard, not after a mouse click. That is a
  deliberate policy, not an oversight.
- A ring must be at least 3:1 against what it is drawn on. Draw it outside an inverted pill
  (`outline-offset` ≥ 1px), never inset on it.
- Inputs show focus with `--focus` and keep a transparent outline, which forced-colors mode
  paints as the ring.
- `html { scroll-padding-top }` keeps focused elements clear of the sticky header.

## Accessibility rules that the static tests cannot see

- Every state that relies on a fill (selected tab, checked segment, pressed toggle) has a
  `forced-colors` rule.
- No screen scrolls sideways at 320px (check with Playwright).
- Errors that appear without a focus move use `role="alert"`.
- Motion only inside `prefers-reduced-motion: no-preference`; nothing loops more than 5s.

## Copy

- Every user-visible string comes from `src/i18n/messages.ts`, in Slovenian and English.
- No em or en dashes. Future tense for anything not built yet.
- Tax rules and rates come from the preview model, never hard-coded in a component.
