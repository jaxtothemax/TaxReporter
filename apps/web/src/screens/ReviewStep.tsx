/**
 * The review: four headline cards, then tabs for the two forms and the notes.
 * Notes that need attention are announced above the tabs, and blocking ones
 * stop the flow. With the user's own (unread) files there is nothing to show
 * yet, so the screen says so and offers the demo instead.
 */
import {
  ArrowRightIcon,
  InfoIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { formatNumber, formatPercent, plural } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import { HOLDING_BUCKETS, type ReturnPreview } from "../model/preview";
import { TAX_YEAR } from "../state/wizard";
import { bucketLabel, Eur } from "../ui/bits";
import { CompareBars, MonthBars, StackBar } from "../ui/charts";
import { Amount, Button, Chip, Note, Tabs } from "../ui/kit";
import { DividendsPanel } from "./review/DividendsPanel";
import { GainsPanel } from "./review/GainsPanel";
import { NotesPanel } from "./review/NotesPanel";

type ReviewTab = "gains" | "dividends" | "notes";

export function EmptyReview({
  onStartDemo,
}: {
  readonly onStartDemo: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card empty-card">
      <span className="icon-tile" aria-hidden>
        <MagnifyingGlassIcon size={22} weight="bold" />
      </span>
      <h2>{t.review.emptyTitle}</h2>
      <p className="muted">{t.review.emptyBody}</p>
      <Button variant="primary" size="lg" onClick={onStartDemo}>
        {t.start.primaryCta}
        <ArrowRightIcon size={18} weight="bold" aria-hidden />
      </Button>
    </div>
  );
}

/** The headline figures. Every amount comes from the preview; none is computed here. */
function Summary({ preview }: { readonly preview: ReturnPreview }) {
  const { locale, t } = useI18n();
  const gains = preview.gainsEstimate;
  const dividends = preview.dividendsEstimate;
  const buckets = HOLDING_BUCKETS.filter(
    (b) => gains.allocatedByBucket[b] !== "0.00",
  );
  return (
    <div className="summary">
      <div className="bento">
        <div className="card stat-card span-7">
          <div className="stat-head">
            <p className="stat-label">{t.review.gainsTaxLabel}</p>
            <Chip>{t.review.estimateChip}</Chip>
          </div>
          <Amount value={gains.taxEur} size="xl" />
          <dl className="kv">
            <div>
              <dt>{t.review.netBase}</dt>
              <dd>
                <Eur value={gains.netBaseEur} strong />
              </dd>
            </div>
          </dl>
          <div className="stat-chart">
            <p className="mini-title">{t.review.bucketsTitle}</p>
            <StackBar
              segments={buckets.map((b) => ({
                key: b,
                label: t.review.allocatedBucket(bucketLabel(b, locale)),
                value: gains.allocatedByBucket[b],
              }))}
            />
          </div>
        </div>

        <div className="card stat-card span-5">
          <div className="stat-head">
            <p className="stat-label">{t.review.colGain}</p>
          </div>
          <Amount value={preview.gainsTotals.gainEur} size="lg" signed />
          <CompareBars
            rows={[
              {
                key: "proceeds",
                label: t.review.colProceeds,
                value: preview.gainsTotals.proceedsEur,
              },
              {
                key: "cost",
                label: t.review.colCost,
                value: preview.gainsTotals.costEur,
              },
            ]}
          />
          <dl className="kv">
            <div>
              <dt>{t.review.salesLabel}</dt>
              <dd className="num strong">
                {formatNumber(String(preview.securities.length), locale)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="card stat-card span-7">
          <div className="stat-head">
            <p className="stat-label">{t.review.dividendsLabel}</p>
          </div>
          <Amount value={dividends.grossEur} size="lg" />
          <div className="stat-chart">
            <p className="mini-title">{t.review.byMonthTitle}</p>
            <MonthBars months={preview.dividendsByMonth} />
          </div>
        </div>

        <div className="card stat-card span-5">
          <div className="stat-head">
            <p className="stat-label">{t.review.dividendsTaxLabel}</p>
            <Chip>{t.review.estimateChip}</Chip>
          </div>
          <Amount value={dividends.taxDueEur} size="lg" />
          {/* Per payment, the tax due is 25% of the gross minus the
              credited foreign tax, so the two shares make up the 25%. */}
          <div className="stat-chart">
            <p className="mini-title">
              {t.review.dividendSplitTitle(
                formatPercent(dividends.taxRate, locale),
              )}
            </p>
            <StackBar
              segments={[
                {
                  key: "credit",
                  label: t.review.creditLabel,
                  value: dividends.creditEur,
                },
                {
                  key: "due",
                  label: t.review.stillDue,
                  value: dividends.taxDueEur,
                },
              ]}
            />
          </div>
          <dl className="kv">
            <div>
              <dt>{t.review.colForeignTax}</dt>
              <dd>
                <Eur value={dividends.foreignTaxEur} />
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="with-icon muted small">
        <InfoIcon size={16} weight="bold" aria-hidden />
        {t.review.estimateNote}
      </p>
    </div>
  );
}

function TabLabel({
  text,
  tag,
  tagIsForm = false,
}: {
  readonly text: string;
  readonly tag: string;
  readonly tagIsForm?: boolean;
}) {
  return (
    <>
      {text}{" "}
      <span className={tagIsForm ? "tab-tag mono is-form" : "tab-tag"}>
        {tag}
      </span>
    </>
  );
}

export function ReviewStep({
  preview,
  onBack,
  onNext,
  onStartDemo,
}: {
  readonly preview: ReturnPreview | null;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onStartDemo: () => void;
}) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<ReviewTab>("gains");
  const year = String(preview?.taxYear ?? TAX_YEAR);
  const notes = preview?.diagnostics ?? [];
  const noteCount = formatNumber(String(notes.length), locale);
  const blocking = notes.filter((d) => d.severity === "blocking").length;
  const needAttention = notes.filter((d) => d.severity !== "info").length;

  function showNotes(): void {
    setTab("notes");
    document.getElementById("review-tab-notes")?.focus();
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1 tabIndex={-1}>{t.review.title(year)}</h1>
        <p className="lead">{t.review.intro}</p>
      </header>

      {preview === null ? (
        <EmptyReview onStartDemo={onStartDemo} />
      ) : (
        <>
          <Summary preview={preview} />

          {needAttention === 0 ? null : (
            <Note
              tone={blocking > 0 ? "danger" : "warn"}
              id="review-attention"
              action={
                <Button variant="ghost" size="sm" onClick={showNotes}>
                  {t.review.showNotes}
                </Button>
              }
            >
              {plural(needAttention, locale, t.review.attention)}
              {blocking > 0 ? ` ${t.review.blocked}` : ""}
            </Note>
          )}

          <Tabs
            idPrefix="review"
            label={t.review.tabsLabel}
            selected={tab}
            onSelect={setTab}
            items={[
              {
                id: "gains",
                label: (
                  <TabLabel
                    text={t.review.tabGainsShort}
                    tag={t.download.kdvpTitle}
                    tagIsForm
                  />
                ),
                panel: (
                  <>
                    <h2 className="visually-hidden">{t.review.tabGains}</h2>
                    <GainsPanel
                      securities={preview.securities}
                      estimate={preview.gainsEstimate}
                    />
                  </>
                ),
              },
              {
                id: "dividends",
                label: (
                  <TabLabel
                    text={t.review.tabDividendsShort}
                    tag={t.download.divTitle}
                    tagIsForm
                  />
                ),
                panel: (
                  <>
                    <h2 className="visually-hidden">{t.review.tabDividends}</h2>
                    <DividendsPanel
                      dividends={preview.dividends}
                      totals={preview.dividendsEstimate}
                    />
                  </>
                ),
              },
              {
                id: "notes",
                label: (
                  <TabLabel text={t.review.tabNotesShort} tag={noteCount} />
                ),
                panel: (
                  <>
                    <h2 className="visually-hidden">
                      {t.review.tabNotes(noteCount)}
                    </h2>
                    <NotesPanel diagnostics={preview.diagnostics} />
                  </>
                ),
              },
            ]}
          />
        </>
      )}

      <div className="actions-row">
        <Button size="lg" onClick={onBack}>
          {t.nav.back}
        </Button>
        {preview === null ? null : (
          <Button
            variant="primary"
            size="lg"
            onClick={onNext}
            disabled={blocking > 0}
            aria-describedby={blocking > 0 ? "review-attention" : undefined}
          >
            {t.nav.next}
            <ArrowRightIcon size={18} weight="bold" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
