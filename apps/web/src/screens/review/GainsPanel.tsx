/**
 * Doh-KDVP: one disclosure per security, holding its inventory list (what the
 * XML will contain) and the FIFO-matched lots behind the gain, followed by how
 * the estimate is built. Native <details> keeps the disclosure accessible.
 */
import { CaretDownIcon } from "@phosphor-icons/react";
import {
  Badge,
  Box,
  DataList,
  Flex,
  Heading,
  Table,
  Text,
} from "@radix-ui/themes";

import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  plural,
} from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import {
  HOLDING_BUCKETS,
  type GainsEstimate,
  type HoldingBucket,
  type SecurityResult,
} from "../../model/preview";
import {
  BrokerName,
  Eur,
  Note,
  RateText,
  SourceText,
  useScrollRegion,
} from "../../ui/bits";

/** "25" → "25 %" in Slovenian, "25%" in English. */
function bucketLabel(bucket: HoldingBucket, locale: "sl" | "en"): string {
  return formatPercent(`0.${bucket.padStart(2, "0")}`, locale);
}

function InventoryTable({ security }: { readonly security: SecurityResult }) {
  const { locale, t } = useI18n();
  const caption = `${security.symbol}: ${t.review.rowsTitle}`;
  const region = useScrollRegion(caption);
  return (
    <Table.Root size="1" variant="surface" className="data-table" ref={region}>
      <caption className="visually-hidden">{caption}</caption>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>{t.review.colDate}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colType}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colQuantity}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colPrice}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colRate}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colEurPerUnit}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colSource}</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {security.rows.map((row) => (
          <Table.Row key={`${row.source.file}:${String(row.source.row)}`}>
            <Table.RowHeaderCell className="num nowrap">
              {formatDate(row.date, locale)}
            </Table.RowHeaderCell>
            <Table.Cell>
              <Flex direction="column" gap="1">
                <Text weight={row.kind === "sale" ? "medium" : "regular"}>
                  {row.kind === "sale" ? t.review.sale : t.review.purchase}
                </Text>
                {row.splitAdjusted === undefined ? null : (
                  <Text size="2" color="gray">
                    {t.review.splitNote(
                      row.splitAdjusted.ratio,
                      formatDate(row.splitAdjusted.date, locale),
                    )}
                  </Text>
                )}
              </Flex>
            </Table.Cell>
            <Table.Cell justify="end" className="num">
              {formatNumber(row.quantity, locale, { maxFraction: 8 })}
            </Table.Cell>
            <Table.Cell justify="end" className="num nowrap">
              {formatMoney(row.price.amount, row.price.currency, locale)}
            </Table.Cell>
            <Table.Cell>
              <RateText rate={row.rate} />
            </Table.Cell>
            <Table.Cell justify="end" className="num">
              {formatNumber(row.priceEur, locale, {
                minFraction: 2,
                maxFraction: 8,
              })}
            </Table.Cell>
            <Table.Cell>
              <Flex direction="column" gap="1">
                <Text size="1">
                  <BrokerName broker={row.broker} />
                </Text>
                <SourceText source={row.source} />
              </Flex>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function LotsTable({ security }: { readonly security: SecurityResult }) {
  const { locale, t } = useI18n();
  const caption = `${security.symbol}: ${t.review.lotsTitle}`;
  const region = useScrollRegion(caption);
  return (
    <Table.Root size="1" variant="surface" className="data-table" ref={region}>
      <caption className="visually-hidden">{caption}</caption>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>{t.review.colBought}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colQuantity}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colAcquisition}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colDisposal}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colGain}
          </Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>{t.review.colHeld}</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">
            {t.review.colBucket}
          </Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {security.lots.map((lot) => (
          <Table.Row key={`${lot.purchaseDate}:${lot.saleDate}`}>
            <Table.RowHeaderCell className="num nowrap">
              {formatDate(lot.purchaseDate, locale)}
            </Table.RowHeaderCell>
            <Table.Cell justify="end" className="num">
              {formatNumber(lot.quantity, locale, { maxFraction: 8 })}
            </Table.Cell>
            <Table.Cell justify="end">
              <Eur value={lot.acquisitionEur} />
            </Table.Cell>
            <Table.Cell justify="end">
              <Eur value={lot.disposalEur} />
            </Table.Cell>
            <Table.Cell justify="end">
              <Eur value={lot.gainEur} signed />
            </Table.Cell>
            <Table.Cell className="nowrap">
              {plural(lot.yearsHeld, locale, t.review.years)}
            </Table.Cell>
            <Table.Cell justify="end" className="num">
              {bucketLabel(lot.bucket, locale)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function SecurityItem({ security }: { readonly security: SecurityResult }) {
  const { locale, t } = useI18n();
  return (
    <details className="security">
      <summary aria-describedby={`hint-${security.isin}`}>
        <span
          id={`hint-${security.isin}`}
          className="visually-hidden"
          aria-hidden
        >
          {t.review.showDetails(security.symbol)}
        </span>
        <span className="security-head">
          <span className="security-id">
            <Text weight="bold" className="mono">
              {security.symbol}
            </Text>
            <Text size="2" color="gray" className="security-name">
              {security.name}
            </Text>
          </span>
          <span className="security-brokers">
            {security.brokers.map((broker) => (
              <Badge key={broker} variant="soft" color="gray">
                <BrokerName broker={broker} />
              </Badge>
            ))}
          </span>
        </span>
        <span className="security-figures">
          <span>
            <Text size="1" color="gray">
              {t.review.colSold}
            </Text>
            <Text className="num">
              {formatNumber(security.quantitySold, locale, { maxFraction: 8 })}
            </Text>
          </span>
          <span>
            <Text size="1" color="gray">
              {t.review.colProceeds}
            </Text>
            <Eur value={security.proceedsEur} />
          </span>
          <span>
            <Text size="1" color="gray">
              {t.review.colCost}
            </Text>
            <Eur value={security.costEur} />
          </span>
          <span>
            <Text size="1" color="gray">
              {t.review.colGain}
            </Text>
            <Eur value={security.gainEur} signed strong />
          </span>
        </span>
        <CaretDownIcon
          size={18}
          weight="bold"
          aria-hidden
          className="security-caret"
        />
      </summary>
      <Box className="security-body">
        <Heading as="h3" size="2" mb="2">
          {t.review.rowsTitle}
        </Heading>
        <InventoryTable security={security} />
        <Heading as="h3" size="2" mt="5" mb="2">
          {t.review.lotsTitle}
        </Heading>
        <LotsTable security={security} />
      </Box>
    </details>
  );
}

function EstimateBreakdown({ estimate }: { readonly estimate: GainsEstimate }) {
  const { locale, t } = useI18n();
  const used = HOLDING_BUCKETS.filter(
    (b) => estimate.positiveByBucket[b] !== "0.00",
  );
  return (
    <Box className="estimate">
      <Heading as="h3" size="4" mb="4">
        {t.review.estimateTitle}
      </Heading>
      <DataList.Root orientation={{ initial: "vertical", sm: "horizontal" }}>
        {used.map((b) => (
          <DataList.Item key={`positive-${b}`}>
            <DataList.Label minWidth={{ initial: "0", sm: "320px" }}>
              {t.review.positiveBucket(bucketLabel(b, locale))}
            </DataList.Label>
            <DataList.Value>
              <Eur value={estimate.positiveByBucket[b]} />
            </DataList.Value>
          </DataList.Item>
        ))}
        <DataList.Item>
          <DataList.Label minWidth={{ initial: "0", sm: "320px" }}>
            {t.review.losses}
          </DataList.Label>
          <DataList.Value>
            <Eur value={estimate.lossesEur} />
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label minWidth={{ initial: "0", sm: "320px" }}>
            {t.review.netBase}
          </DataList.Label>
          <DataList.Value>
            <Eur value={estimate.netBaseEur} strong />
          </DataList.Value>
        </DataList.Item>
        {used.map((b) => (
          <DataList.Item key={`allocated-${b}`}>
            <DataList.Label minWidth={{ initial: "0", sm: "320px" }}>
              {t.review.allocatedBucket(bucketLabel(b, locale))}
            </DataList.Label>
            <DataList.Value>
              <Eur value={estimate.allocatedByBucket[b]} />
            </DataList.Value>
          </DataList.Item>
        ))}
        <DataList.Item>
          <DataList.Label minWidth={{ initial: "0", sm: "320px" }}>
            {t.review.estimatedTax}
          </DataList.Label>
          <DataList.Value>
            <Text size="4">
              <Eur value={estimate.taxEur} strong />
            </Text>
          </DataList.Value>
        </DataList.Item>
      </DataList.Root>
    </Box>
  );
}

export function GainsPanel({
  securities,
  estimate,
}: {
  readonly securities: readonly SecurityResult[];
  readonly estimate: GainsEstimate;
}) {
  const { t } = useI18n();
  if (securities.length === 0) {
    return <Note tone="gray">{t.review.noSales}</Note>;
  }
  return (
    <Flex direction="column" gap="7">
      <div className="security-list">
        {securities.map((security) => (
          <SecurityItem key={security.isin} security={security} />
        ))}
      </div>
      <EstimateBreakdown estimate={estimate} />
    </Flex>
  );
}
