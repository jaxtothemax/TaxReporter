/**
 * The app's own component kit: buttons, chips, amounts, notes, tables and
 * tabs, styled by styles.css. Native elements first; ARIA only where HTML has
 * no element for the pattern (tabs).
 */
import {
  InfoIcon,
  TrendDownIcon,
  TrendUpIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import {
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { formatEur, formatEurParts, isNegative } from "../i18n/format";
import { useI18n } from "../i18n/i18n";

/** Joins class names, skipping the ones a condition turned off. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly size?: "md" | "lg";
};

/** A pill button. Defaults to type="button", so it never submits by accident. */
export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", `btn-${variant}`, `btn-${size}`, className)}
      {...rest}
    />
  );
}

/** A round icon-only button; the label is required because nothing is visible. */
export function IconButton({
  label,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<"button">, "aria-label"> & {
  readonly label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx("icon-btn", className)}
      {...rest}
    />
  );
}

export function Chip({
  tone = "neutral",
  className,
  children,
}: {
  readonly tone?: "neutral" | "accent" | "warn" | "loss";
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span className={cx("chip", `chip-${tone}`, className)}>{children}</span>
  );
}

/**
 * A gain or loss as a pill: green and rising for a gain, red and falling for a
 * loss, with the sign in the text so color is never the only signal.
 */
export function DeltaPill({ value }: { readonly value: string }) {
  const { locale } = useI18n();
  const flat = !/[1-9]/.test(value);
  const loss = isNegative(value);
  const Icon = loss ? TrendDownIcon : TrendUpIcon;
  return (
    <span
      className={cx(
        "delta",
        flat ? "delta-flat" : loss ? "delta-down" : "delta-up",
      )}
    >
      {flat ? null : <Icon size={14} weight="bold" aria-hidden />}
      {formatEur(value, locale, { signed: true })}
    </span>
  );
}

/** A stable hue for a ticker, so AAPL always gets the same tile color. */
export function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 3600;
  }
  return hash % 360;
}

/**
 * A ticker tile standing in for a company logo: logos would mean bundling
 * trademarks or fetching them from a third party, and the app does neither.
 * Decorative: the symbol is always written out next to it.
 */
export function Ticker({ symbol }: { readonly symbol: string }) {
  return (
    <span
      className="ticker"
      aria-hidden
      style={{ "--hue": String(hueOf(symbol)) } as CSSProperties}
    >
      {symbol.slice(0, 4)}
    </span>
  );
}

/**
 * A headline euro amount with the cents and currency set smaller. Screen
 * readers get the whole formatted amount in one piece, since some read
 * adjacent spans as separate items.
 */
export function Amount({
  value,
  size = "lg",
  signed = false,
}: {
  readonly value: string;
  readonly size?: "md" | "lg" | "xl";
  readonly signed?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <span
      className={cx(
        "amount",
        `amount-${size}`,
        isNegative(value) && "is-loss",
        signed && !isNegative(value) && /[1-9]/.test(value) && "is-gain",
      )}
    >
      <span aria-hidden className="amount-parts">
        {formatEurParts(value, locale, { signed }).map((part, i) => (
          <span key={i} className={`amount-${part.role}`}>
            {part.text}
          </span>
        ))}
      </span>
      <span className="visually-hidden">
        {formatEur(value, locale, { signed })}
      </span>
    </span>
  );
}

const NOTE_ICONS = {
  neutral: InfoIcon,
  warn: WarningIcon,
  danger: WarningOctagonIcon,
} as const;

/**
 * The one callout recipe: an icon, role="note", and a tinted panel. The id
 * goes on the text, so aria-describedby pointing at it reads the message and
 * not the action button next to it.
 */
export function Note({
  tone,
  id,
  action,
  children,
}: {
  readonly tone: keyof typeof NOTE_ICONS;
  readonly id?: string;
  /** A button placed at the end of the note, e.g. to open the details. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const Icon = NOTE_ICONS[tone];
  return (
    <div role="note" className={cx("note", `note-${tone}`)}>
      <span className="note-icon">
        <Icon size={18} weight="bold" aria-hidden />
      </span>
      <div className="note-body" id={id}>
        {children}
      </div>
      {action === undefined ? null : (
        <div className="note-action">{action}</div>
      )}
    </div>
  );
}

/**
 * A table in a named, focusable scroll region. A table wider than a phone
 * scrolls sideways, and a scroller that cannot take focus cannot be scrolled
 * from the keyboard in every browser (WCAG 2.1.1). The caption names the table
 * for screen readers; the region repeats it for the scroller.
 */
export function DataTable({
  caption,
  className,
  children,
}: {
  readonly caption: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className={cx("table", className)}>
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: ReactNode;
  readonly panel: ReactNode;
}

/** Which tab an arrow, Home or End key moves to, or null for any other key. */
export function tabTarget(
  key: string,
  index: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * WAI-ARIA tabs with automatic activation: arrows move between tabs and show
 * the panel, Tab moves into the panel. Every panel is rendered and the
 * inactive ones are hidden, so each tab's aria-controls points at a real
 * element.
 */
export function Tabs<Id extends string>({
  idPrefix,
  label,
  items,
  selected,
  onSelect,
}: {
  readonly idPrefix: string;
  readonly label: string;
  readonly items: readonly TabItem<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = tabTarget(event.key, index, items.length);
    const item = target === null ? undefined : items[target];
    if (target === null || item === undefined) return;
    event.preventDefault();
    onSelect(item.id);
    tabs.current[target]?.focus();
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tab-list">
        {items.map((item, index) => {
          const active = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`${idPrefix}-panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              className="tab"
              onClick={() => {
                onSelect(item.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${idPrefix}-panel-${item.id}`}
          aria-labelledby={`${idPrefix}-tab-${item.id}`}
          tabIndex={0}
          hidden={item.id !== selected}
          className="tab-panel"
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
