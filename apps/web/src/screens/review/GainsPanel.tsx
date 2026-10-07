/**
 * Doh-KDVP: one disclosure per security, holding its inventory list (what the
 * XML will contain) and the FIFO-matched lots behind the gain, followed by how
 * the estimate is built. Native <details> keeps the disclosure accessible.
 */
import { CaretDownIcon } from "@phosphor-icons/react";

import {
  formatDate,
  formatMoney,
  formatNumber,
  plural,
} from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import {
  HOLDING_BUCKETS,
  type GainsEstimate,
  type SecurityResult,
} from "../../model/preview";
import {
  BrokerName,
  bucketLabel,
  Eur,
  RateText,
  SourceText,
} from "../../ui/bits";
import {
  Amount,
  Chip,
  cx,
  DataTable,
  DeltaPill,
  Note,
  SecurityMark,
} from "../../ui/kit";

function InventoryTable({ security }: { readonly security: SecurityResult }) {
  const { locale, t } = useI18n();
  return (
    <DataTable caption={`${security.symbol}: ${t.review.rowsTitle}`}>
      <thead>
        <tr>
          <th scope="col">{t.review.colDate}</th>
          <th scope="col">{t.review.colType}</th>
          <th scope="col" className="end">
            {t.review.colQuantity}
          </th>
          <th scope="col" className="end">
            {t.review.colPrice}
          </th>
          <th scope="col">{t.review.colRate}</th>
          <th scope="col" className="end">
            {t.review.colEurPerUnit}
          </th>
          <th scope="col">{t.review.colSource}</th>
        </tr>
      </thead>
      <tbody>
        {security.rows.map((row) => (
          <tr key={`${row.source.file}:${String(row.source.row)}`}>
            <th scope="row" className="num nowrap">
              {formatDate(row.date, locale)}
            </th>
            <td>
              <span className="stack-tight">
                <span>
                  <Chip tone={row.kind === "sale" ? "accent" : "neutral"}>
                    {row.kind === "sale" ? t.review.sale : t.review.purchase}
                  </Chip>
                </span>
                {row.splitAdjusted === undefined ? null : (
                  <span className="muted small">
                    {t.review.splitNote(
                      row.splitAdjusted.ratio,
                      formatDate(row.splitAdjusted.date, locale),
                    )}
                  </span>
                )}
              </span>
            </td>
            <td className="end num">
              {formatNumber(row.quantity, locale, { maxFraction: 8 })}
            </td>
            <td className="end num nowrap">
              {formatMoney(row.price.amount, row.price.currency, locale)}
            </td>
            <td>
              <RateText rate={row.rate} />
            </td>
            <td className="end num">
              {formatNumber(row.priceEur, locale, {
                minFraction: 2,
                maxFraction: 8,
              })}
            </td>
            <td>
              <span className="stack-tight">
                <span className="small">
                  <BrokerName broker={row.broker} />
                </span>
                <SourceText source={row.source} />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function LotsTable({ security }: { readonly security: SecurityResult }) {
  const { locale, t } = useI18n();
  return (
    <DataTable caption={`${security.symbol}: ${t.review.lotsTitle}`}>
      <thead>
        <tr>
          <th scope="col">{t.review.colBought}</th>
          <th scope="col" className="end">
            {t.review.colQuantity}
          </th>
          <th scope="col" className="end">
            {t.review.colAcquisition}
          </th>
          <th scope="col" className="end">
            {t.review.colDisposal}
          </th>
          <th scope="col" className="end">
            {t.review.colGain}
          </th>
          <th scope="col">{t.review.colHeld}</th>
          <th scope="col" className="end">
            {t.review.colBucket}
          </th>
        </tr>
      </thead>
      <tbody>
        {security.lots.map((lot) => (
          <tr key={`${lot.purchaseDate}:${lot.saleDate}`}>
            <th scope="row" className="num nowrap">
              {formatDate(lot.purchaseDate, locale)}
            </th>
            <td className="end num">
              {formatNumber(lot.quantity, locale, { maxFraction: 8 })}
            </td>
            <td className="end">
              <Eur value={lot.acquisitionEur} />
            </td>
            <td className="end">
              <Eur value={lot.disposalEur} />
            </td>
            <td className="end">
              <Eur value={lot.gainEur} signed strong />
            </td>
            <td className="nowrap">
              {plural(lot.yearsHeld, locale, t.review.years)}
            </td>
            <td className="end">
              <Chip>{bucketLabel(lot.bucket, locale)}</Chip>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
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
        <span className="security-id">
          <SecurityMark isin={security.isin} symbol={security.symbol} />
          <span className="security-names">
            <span className="security-symbol">{security.symbol}</span>
            <span className="security-name">{security.name}</span>
          </span>
        </span>
        <span className="security-brokers">
          {security.brokers.map((broker) => (
            <Chip key={broker}>
              <BrokerName broker={broker} />
            </Chip>
          ))}
        </span>
        <span className="security-figures">
          <span className="fig">
            <span className="fig-label">{t.review.colSold}</span>
            <span className="num">
              {formatNumber(security.quantitySold, locale, { maxFraction: 8 })}
            </span>
          </span>
          <span className="fig">
            <span className="fig-label">{t.review.colProceeds}</span>
            <Eur value={security.proceedsEur} />
          </span>
          <span className="fig">
            <span className="fig-label">{t.review.colCost}</span>
            <Eur value={security.costEur} />
          </span>
          <span className="fig">
            <span className="fig-label">{t.review.colGain}</span>
            <DeltaPill value={security.gainEur} />
          </span>
        </span>
        <CaretDownIcon
          size={18}
          weight="bold"
          aria-hidden
          className="security-caret"
        />
      </summary>
      <div className="security-body">
        <h3 className="sub-title">{t.review.rowsTitle}</h3>
        <InventoryTable security={security} />
        <h3 className="sub-title">{t.review.lotsTitle}</h3>
        <LotsTable security={security} />
      </div>
    </details>
  );
}

function EstimateBreakdown({ estimate }: { readonly estimate: GainsEstimate }) {
  const { locale, t } = useI18n();
  const used = HOLDING_BUCKETS.filter(
    (b) => estimate.positiveByBucket[b] !== "0.00",
  );
  const row = (
    key: string,
    label: string,
    value: string,
    kind?: "subtotal",
  ) => (
    <div key={key} className={cx("ledger-row", kind && `is-${kind}`)}>
      <dt>{label}</dt>
      <dd>
        <Eur value={value} strong={kind === "subtotal"} />
      </dd>
    </div>
  );
  return (
    <div className="card ledger-card">
      <div className="ledger-head">
        <h3>{t.review.estimateTitle}</h3>
        <Chip>{t.review.estimateChip}</Chip>
      </div>
      <dl className="ledger">
        {used.map((b) =>
          row(
            `positive-${b}`,
            t.review.positiveBucket(bucketLabel(b, locale)),
            estimate.positiveByBucket[b],
          ),
        )}
        {row("losses", t.review.losses, estimate.lossesEur)}
        {row("net", t.review.netBase, estimate.netBaseEur, "subtotal")}
        {used.map((b) =>
          row(
            `allocated-${b}`,
            t.review.allocatedBucket(bucketLabel(b, locale)),
            estimate.allocatedByBucket[b],
          ),
        )}
        <div className="ledger-row is-total">
          <dt>{t.review.estimatedTax}</dt>
          <dd>
            <Amount value={estimate.taxEur} size="md" />
          </dd>
        </div>
      </dl>
    </div>
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
    return <Note tone="neutral">{t.review.noSales}</Note>;
  }
  return (
    <div className="panel-stack">
      <div className="security-list">
        {securities.map((security) => (
          <SecurityItem key={security.isin} security={security} />
        ))}
      </div>
      <EstimateBreakdown estimate={estimate} />
    </div>
  );
}
