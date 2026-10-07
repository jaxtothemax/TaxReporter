/**
 * Doh-Div: one row per payment, as FURS requires, with the foreign tax that
 * was withheld and the part of it that can be credited (capped by the treaty
 * rate and by the Slovenian tax; docs/research/04-si-tax-rules.md).
 */
import { Flex, Table, Text } from "@radix-ui/themes";

import {
  formatCountry,
  formatDate,
  formatMoney,
  formatPercent,
} from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import type { DividendRow, DividendsEstimate } from "../../model/preview";
import {
  BrokerName,
  Eur,
  Note,
  RateText,
  SourceText,
  useScrollRegion,
} from "../../ui/bits";

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
  const region = useScrollRegion(t.review.tabDividends);
  if (dividends.length === 0) {
    return <Note tone="gray">{t.review.noDividends}</Note>;
  }
  // Date order, as on a broker statement, whatever order the files came in.
  const rows = [...dividends].sort(
    (a, b) => a.date.localeCompare(b.date) || a.payer.localeCompare(b.payer),
  );
  return (
    <Table.Root size="2" variant="surface" className="data-table" ref={region}>
      <caption className="visually-hidden">{t.review.tabDividends}</caption>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>{t.review.colDate}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colPayer}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colCountry}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colGross}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colForeignTax}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colCredit}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colRate}</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={`${row.source.file}:${String(row.source.row)}`}>
            <Table.RowHeaderCell className="num nowrap">
              {formatDate(row.date, locale)}
            </Table.RowHeaderCell>
            <Table.Cell>
              <Flex direction="column" gap="1">
                <Text weight="medium">{row.payer}</Text>
                <Text size="1" color="gray">
                  <BrokerName broker={row.broker} />
                </Text>
                <SourceText source={row.source} />
              </Flex>
            </Table.Cell>
            <Table.Cell className="nowrap">
              {formatCountry(row.country, locale)}
            </Table.Cell>
            <Table.Cell justify="end">
              <Flex direction="column" gap="1" align="end">
                <Eur value={row.grossEur} />
                {row.gross.currency === "EUR" ? null : (
                  <Text size="1" color="gray" className="num">
                    {formatMoney(row.gross.amount, row.gross.currency, locale)}
                  </Text>
                )}
              </Flex>
            </Table.Cell>
            <Table.Cell justify="end">
              <Eur value={row.foreignTaxEur} />
            </Table.Cell>
            <Table.Cell justify="end">
              <Flex direction="column" gap="1" align="end">
                <Eur value={row.creditEur} />
                {isCapped(row) && row.treatyRate !== null ? (
                  <Text size="2" color="amber" className="cap-note">
                    {t.review.creditCapped(
                      formatPercent(row.treatyRate, locale),
                    )}
                  </Text>
                ) : null}
              </Flex>
            </Table.Cell>
            <Table.Cell>
              <RateText rate={row.rate} />
            </Table.Cell>
          </Table.Row>
        ))}
        <Table.Row className="total-row">
          <Table.RowHeaderCell colSpan={3}>
            <Text weight="bold">{t.review.dividendsTotal}</Text>
          </Table.RowHeaderCell>
          <Table.Cell justify="end">
            <Eur value={totals.grossEur} strong />
          </Table.Cell>
          <Table.Cell justify="end">
            <Eur value={totals.foreignTaxEur} strong />
          </Table.Cell>
          <Table.Cell justify="end">
            <Eur value={totals.creditEur} strong />
          </Table.Cell>
          <Table.Cell />
        </Table.Row>
      </Table.Body>
    </Table.Root>
  );
}
