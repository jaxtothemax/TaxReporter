/**
 * Small charts drawn with CSS: bar lengths are percentages, so they follow the
 * layout and both color schemes without a charting library. Each chart sits
 * next to text that carries every figure (a legend, a list or labels); the
 * bars themselves are hidden from screen readers.
 */
import type { CSSProperties } from "react";

import { formatEur, formatMonth } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { DecimalString, MonthlyAmount } from "../model/preview";
import { cx } from "./kit";

function nonNegative(values: readonly DecimalString[]): number[] {
  return values.map((value) => Math.max(0, Number(value)));
}

/**
 * Bar lengths as fractions of the largest value. Geometry only: decimal
 * strings become floats here to size a bar on screen, never to compute a
 * figure that is shown or filed (ADR 0006).
 */
export function barFractions(values: readonly DecimalString[]): number[] {
  const numbers = nonNegative(values);
  const max = Math.max(0, ...numbers);
  return numbers.map((n) => (max === 0 ? 0 : n / max));
}

/** Each value's share of the total, for a stacked bar. Geometry only, as above. */
export function shareFractions(values: readonly DecimalString[]): number[] {
  const numbers = nonNegative(values);
  const total = numbers.reduce((sum, n) => sum + n, 0);
  return numbers.map((n) => (total === 0 ? 0 : n / total));
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

export interface Segment {
  readonly key: string;
  readonly label: string;
  readonly value: DecimalString;
}

/** One bar split into shares, with a legend that names each share's amount. */
export function StackBar({
  segments,
  compact = false,
}: {
  readonly segments: readonly Segment[];
  readonly compact?: boolean;
}) {
  const { locale } = useI18n();
  const shares = shareFractions(segments.map((s) => s.value));
  return (
    <div className={cx("stack", compact && "stack-compact")}>
      <div className="stack-bar" aria-hidden>
        {segments.map((segment, i) => (
          <span
            key={segment.key}
            className={`stack-seg tone-${String(i)}`}
            style={{ width: percent(shares[i] ?? 0) }}
          />
        ))}
      </div>
      <ul className="legend" role="list">
        {segments.map((segment, i) => (
          <li key={segment.key}>
            <span className={`swatch tone-${String(i)}`} aria-hidden />
            <span className="legend-label">{segment.label}</span>
            <span className="legend-value num">
              {formatEur(segment.value, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Twelve monthly columns. The tallest is labeled with its amount; the visually
 * hidden list gives screen readers every month that had a payment.
 */
export function MonthBars({
  months,
}: {
  readonly months: readonly MonthlyAmount[];
}) {
  const { locale, t } = useI18n();
  const fractions = barFractions(months.map((m) => m.grossEur));
  return (
    <div className="months">
      <div className="month-bars" aria-hidden>
        {months.map((month, i) => {
          const fraction = fractions[i] ?? 0;
          return (
            <div key={month.month} className="month-col">
              <div className="month-track">
                {fraction === 1 ? (
                  <span className="month-peak num">
                    {formatEur(month.grossEur, locale)}
                  </span>
                ) : null}
                <span
                  className={cx(
                    "month-bar",
                    fraction === 0 && "is-empty",
                    fraction === 1 && "is-peak",
                  )}
                  style={
                    fraction === 0 ? undefined : { height: percent(fraction) }
                  }
                />
              </div>
              <span className="month-label">
                {formatMonth(month.month, locale, "narrow")}
              </span>
            </div>
          );
        })}
      </div>
      <ul className="visually-hidden">
        {months
          .filter((month) => /[1-9]/.test(month.grossEur))
          .map((month) => (
            <li key={month.month}>
              {t.review.monthAmount(
                formatMonth(month.month, locale, "long"),
                formatEur(month.grossEur, locale),
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * Labeled amounts with bars scaled to the largest, e.g. proceeds against cost.
 * The bar is the row's ::after, sized by --fill, so the list stays valid HTML.
 */
export function CompareBars({ rows }: { readonly rows: readonly Segment[] }) {
  const { locale } = useI18n();
  const fractions = barFractions(rows.map((r) => r.value));
  return (
    <dl className="compare">
      {rows.map((row, i) => (
        <div
          key={row.key}
          className={`compare-row bar-${String(i)}`}
          style={{ "--fill": percent(fractions[i] ?? 0) } as CSSProperties}
        >
          <dt>{row.label}</dt>
          <dd className="num">{formatEur(row.value, locale)}</dd>
        </div>
      ))}
    </dl>
  );
}
