/**
 * Doh-Div: one row per payment, as FURS requires, with the foreign tax that
 * was withheld and the part of it that can be credited (capped by the treaty
 * rate and by the Slovenian tax; docs/research/04-si-tax-rules.md).
 */
import { explain } from "../../explain/anchors";
import {
  formatCountry,
  formatDate,
  formatMoney,
  formatPercent,
} from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import type { DividendRow, DividendsEstimate } from "../../model/preview";
import { BrokerName, Eur, RateText, SourceText } from "../../ui/bits";
import { DataTable, Note, SecurityMark } from "../../ui/kit";

function isCapped(row: DividendRow): boolean {
  return row.creditEur !== row.foreignTaxEur;
}

export function DividendsPanel({
  dividends,
  totals,
}: {
  readonly dividends: readonly DividendRow[];
  readonly totals: DividendsEstimate;
}) {
  const { locale, t } = useI18n();
  if (dividends.length === 0) {
    return <Note tone="neutral">{t.review.noDividends}</Note>;
  }
  // Date order, as on a broker statement, whatever order the files came in.
  const rows = [...dividends].sort(
    (a, b) => a.date.localeCompare(b.date) || a.payer.localeCompare(b.payer),
  );
  const withheld = dividends.some((row) => /[1-9]/.test(row.foreignTaxEur));
  return (
    <div className="panel-stack">
      <DataTable caption={t.review.tabDividends}>
        <thead>
          <tr>
            <th scope="col">{t.review.colDate}</th>
            <th scope="col">{t.review.colPayer}</th>
            <th scope="col">{t.review.colCountry}</th>
            <th scope="col" className="end">
              {t.review.colGross}
            </th>
            <th scope="col" className="end">
              {t.review.colForeignTax}
            </th>
            <th scope="col" className="end">
              {t.review.colCredit}
            </th>
            <th scope="col">{t.review.colRate}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.source.file}:${String(row.source.row)}`}
              {...explain("div.row", `${row.isin}@${row.date}`)}
            >
              <th scope="row" className="num nowrap">
                {formatDate(row.date, locale)}
              </th>
              <td>
                <span className="payer">
                  <SecurityMark isin={row.isin} symbol={row.symbol} labelled />
                  <span className="stack-tight">
                    <span className="strong">{row.payer}</span>
                    <span className="muted small">
                      <BrokerName broker={row.broker} />
                    </span>
                    <SourceText source={row.source} />
                  </span>
                </span>
              </td>
              <td className="nowrap">
                {row.country === "" ? "" : formatCountry(row.country, locale)}
              </td>
              <td className="end" {...explain("div.gross")}>
                <span className="stack-tight align-end">
                  <Eur value={row.grossEur} />
                  {row.gross.currency === "EUR" ? null : (
                    <span className="muted small num nowrap">
                      {formatMoney(
                        row.gross.amount,
                        row.gross.currency,
                        locale,
                      )}
                    </span>
                  )}
                </span>
              </td>
              <td className="end" {...explain("div.foreignTax")}>
                <Eur value={row.foreignTaxEur} />
              </td>
              <td className="end" {...explain("div.credit")}>
                <span className="stack-tight align-end">
                  <Eur value={row.creditEur} />
                  {isCapped(row) && row.treatyRate !== null ? (
                    <span className="cap-note">
                      {t.review.creditCapped(
                        formatPercent(row.treatyRate, locale),
                      )}
                    </span>
                  ) : null}
                </span>
              </td>
              <td {...explain("div.rate")}>
                <RateText rate={row.rate} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              {t.review.dividendsTotal}
            </th>
            <td className="end">
              <Eur value={totals.grossEur} strong />
            </td>
            <td className="end">
              <Eur value={totals.foreignTaxEur} strong />
            </td>
            <td className="end">
              <Eur value={totals.creditEur} strong />
            </td>
            <td />
          </tr>
        </tfoot>
      </DataTable>
      {withheld ? <Note tone="neutral">{t.review.foreignTaxProof}</Note> : null}
    </div>
  );
}
