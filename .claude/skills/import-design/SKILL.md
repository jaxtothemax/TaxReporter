---
name: import-design
description: Convert a design guide, brand guidelines, or design token export into a frontend/CLAUDE.md that the ux-review and ux-design agents use to enforce your design system.
argument-hint: "[path/to/design-guide.md]"
---

# Import Design System

Convert a design guide, brand guidelines, or design token export into a
`frontend/CLAUDE.md` that the `ux-review` and `ux-design` agents use to enforce
your design system.

Usage:
```
/import-design path/to/design-guide.md
/import-design path/to/tokens.json
/import-design  (then paste content when prompted)
```

Without a `frontend/CLAUDE.md`, the UX agents give generic feedback. With one,
they enforce your actual colors, typography, spacing, and component conventions.

---

## Step 1 — Load the design input

If `$ARGUMENTS` is a file path, read it. Otherwise ask:

> "Paste your design guide, brand guidelines, Figma token export (JSON), or
> CSS custom properties. When done, type END on its own line."

---

## Step 2 — Parallel extraction (Sonnet sub-agents)

Launch **2 sub-agents in parallel** (both with `model: "sonnet"`). Wait for both.

**Sub-agent 1 — Extract design tokens:**
> Parse the provided content. Extract all of the following that are present:
> - Color palette: name → hex/rgb value, with semantic labels (primary, secondary, background, text, error, warning, success, border)
> - Typography: font families, size scale (with px and rem), weights, line heights, letter spacing
> - Spacing scale: values (px/rem) with semantic names (xs, sm, md, lg, xl, etc.)
> - Border radius values
> - Shadow/elevation values
> - Breakpoints / responsive grid
>
> Return as structured lists. Mark any category as "not found" if absent.

**Sub-agent 2 — Extract component conventions and rules:**
> Parse the provided content. Extract:
> - Component-specific rules (button variants, input states, modal patterns, etc.)
> - Do/Don't pairs or explicit usage rules
> - Accessibility requirements (contrast ratios, focus styles, ARIA requirements)
> - Animation/transition timing
> - Icon library or system
>
> Return as structured lists. Mark any category as "not found" if absent.

---

## Step 3 — Synthesize into frontend/CLAUDE.md (you do this — do NOT delegate)

Using the extracted tokens and conventions, write `frontend/CLAUDE.md`:

```markdown
# [PROJECT NAME] Frontend Design System

All UI work must follow this design system. The `ux-review` agent checks against
these rules after every UI change.

## Colors

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#XXXXXX` | Primary actions, links |
| ... | | |

## Typography

| Role | Font | Size | Weight | Line height |
|---|---|---|---|---|
| Heading 1 | ... | | | |
| ... | | | | |

## Spacing

| Token | Value | Use |
|---|---|---|
| `--spacing-xs` | `4px` | ... |
| ... | | |

## Components

### Buttons
- [rules extracted from design guide]

### Forms
- [rules]

### [Other components]

## Accessibility

- Minimum contrast ratio: [value]
- Focus styles: [description]
- [other requirements]

## Do / Don't

**Do:**
- [rule]

**Don't:**
- [rule]
```

Fill in only what was present in the input. Use `[not specified]` for categories
that were absent — do not invent values.

---

## Step 4 — Write the file and report

1. Create `frontend/` directory if it doesn't exist
2. Write `frontend/CLAUDE.md`
3. Output a summary:
   ```
   Created frontend/CLAUDE.md

   Populated: colors (X tokens), typography (X styles), spacing (X values), components (X rules)
   Not found: [list any missing categories]

   Review the file and fill in any [not specified] placeholders before using /ux-review.
   ```

---

## Rules

- Never invent token values — only use what was in the input
- Use `[not specified]` as a placeholder, not placeholder colors or fake values
- If the input is a JSON token file (e.g. Figma tokens), extract values from the
  token objects — do not include the JSON structure itself in the output
- If `frontend/CLAUDE.md` already exists, read it first and merge in new values
  rather than overwriting custom conventions that may already be present
