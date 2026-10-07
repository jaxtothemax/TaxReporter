/**
 * The landing screen. Its product shot is made of real components rendering
 * real rows of the demo data (the Apple sale and the gains estimate), not a
 * picture of the UI.
 */
import {
  ArrowRightIcon,
  CheckIcon,
  DownloadSimpleIcon,
  FilesIcon,
  IdentificationCardIcon,
  ListChecksIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { demoPreview } from "../demo/demoPreview";
import { formatDate, formatMoney, formatNumber } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import { BROKERS, HOLDING_BUCKETS } from "../model/preview";
import { bucketLabel, RateChip } from "../ui/bits";
import { StackBar } from "../ui/charts";
import { Amount, Button, Chip, DeltaPill, Ticker } from "../ui/kit";

/**
 * Keeps form names such as "Doh-KDVP" on one line: a line break at their
 * hyphen makes one name read as two words.
 */
export function keepFormNamesWhole(text: string): ReactNode[] {
  return text.split(/(Doh-[A-Za-z]+)/).map((part, i) =>
    part.startsWith("Doh-") ? (
      <span key={i} className="nowrap form-name">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

const STEP_ICONS = [
  FilesIcon,
  IdentificationCardIcon,
  ListChecksIcon,
  DownloadSimpleIcon,
] as const;

function HeroVisual() {
  const { locale, t } = useI18n();
  const apple = demoPreview.securities.find((s) => s.symbol === "AAPL");
  const sale = apple?.rows.find((r) => r.kind === "sale");
  if (apple === undefined || sale === undefined || sale.rate === null) {
    return null;
  }
  const estimate = demoPreview.gainsEstimate;
  const buckets = HOLDING_BUCKETS.filter(
    (b) => estimate.allocatedByBucket[b] !== "0.00",
  );
  return (
    <figure className="hero-visual">
      <div className="glass-card hero-card">
        <div className="hero-card-head">
          <Ticker symbol={apple.symbol} />
          <div className="hero-card-id">
            <p className="strong">{apple.name}</p>
            <p className="muted small">
              {t.start.previewSaleOn(formatDate(sale.date, locale))}
            </p>
          </div>
          <span>
            <span className="visually-hidden">{t.review.colGain} </span>
            <DeltaPill value={apple.gainEur} />
          </span>
        </div>
        <div className="hero-card-amount">
          <p className="label">{t.review.colProceeds}</p>
          <Amount value={apple.proceedsEur} size="xl" />
        </div>
        <dl className="facts">
          <div>
            <dt>{t.review.colQuantity}</dt>
            <dd className="num">
              {formatNumber(sale.quantity, locale, { maxFraction: 8 })}
            </dd>
          </div>
          <div>
            <dt>{t.review.colPrice}</dt>
            <dd className="num">
              {formatMoney(sale.price.amount, sale.price.currency, locale)}
            </dd>
          </div>
          <div>
            <dt>{t.review.colEurPerUnit}</dt>
            <dd className="num">
              {formatNumber(sale.priceEur, locale, {
                minFraction: 2,
                maxFraction: 8,
              })}
            </dd>
          </div>
        </dl>
        <RateChip rate={sale.rate} />
      </div>
      <div className="glass-card hero-float">
        <div className="hero-float-head">
          <p className="label">{t.review.gainsTaxLabel}</p>
          <Chip>{t.review.estimateChip}</Chip>
        </div>
        <Amount value={estimate.taxEur} size="md" />
        <StackBar
          compact
          segments={buckets.map((b) => ({
            key: b,
            label: bucketLabel(b, locale),
            value: estimate.allocatedByBucket[b],
          }))}
        />
      </div>
      <figcaption className="hero-caption">{t.start.previewCaption}</figcaption>
    </figure>
  );
}

export function StartScreen({
  onStartDemo,
  onStartOwn,
}: {
  readonly onStartDemo: () => void;
  readonly onStartOwn: () => void;
}) {
  const { locale, t } = useI18n();
  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden />
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-dot" aria-hidden />
              {t.start.eyebrow}
            </p>
            <h1 tabIndex={-1} className="hero-title">
              {keepFormNamesWhole(t.start.title)}
            </h1>
            <p className="hero-subtitle">{t.start.subtitle}</p>
            <div className="hero-actions">
              <Button variant="primary" size="lg" onClick={onStartDemo}>
                {t.start.primaryCta}
                <ArrowRightIcon size={18} weight="bold" aria-hidden />
              </Button>
              <Button size="lg" onClick={onStartOwn}>
                {t.start.secondaryCta}
              </Button>
            </div>
            <ul className="hero-highlights" role="list">
              {t.start.highlights.map((highlight) => (
                <li key={highlight}>
                  <CheckIcon size={14} weight="bold" aria-hidden />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="section container">
        <h2 className="section-title">{t.start.howTitle}</h2>
        <ol className="how-grid" role="list">
          {t.start.steps.map((step, i) => {
            const Icon = STEP_ICONS[i] ?? FilesIcon;
            return (
              <li key={step.title} className="card how-card">
                <div className="how-card-top">
                  <span className="icon-tile" aria-hidden>
                    <Icon size={20} weight="bold" />
                  </span>
                  <span className="how-index num" aria-hidden>
                    {formatNumber(String(i + 1), locale).padStart(2, "0")}
                  </span>
                </div>
                <h3>{step.title}</h3>
                <p className="muted">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="section container">
        <div className="bento">
          <div className="card privacy-card span-7">
            <span className="icon-tile icon-tile-lg" aria-hidden>
              <ShieldCheckIcon size={26} weight="bold" />
            </span>
            <h2>{t.start.privacyTitle}</h2>
            <p>{t.start.privacyBody}</p>
            <p className="muted small">{t.start.privacyLlm}</p>
          </div>
          <div className="card brokers-card span-5">
            <h2>{t.start.brokersTitle}</h2>
            <h3>{t.start.brokersNowLabel}</h3>
            <ul className="broker-list" role="list">
              {BROKERS.map((broker) => (
                <li key={broker}>
                  <Ticker symbol={t.brokers[broker].charAt(0)} />
                  {t.brokers[broker]}
                </li>
              ))}
            </ul>
            <h3>{t.start.brokersNextLabel}</h3>
            <ul className="chip-list" role="list">
              {t.start.brokersNextNames.map((name) => (
                <li key={name}>
                  <Chip>{name}</Chip>
                </li>
              ))}
              <li>
                <Chip>{t.start.brokersOthers}</Chip>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
