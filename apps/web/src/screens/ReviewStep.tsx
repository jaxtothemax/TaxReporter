/**
 * The review: four headline figures, then tabs for the two forms and the
 * notes. Notes that need attention are announced above the tabs, and blocking
 * ones stop the flow. With the user's own (unread) files there is nothing to
 * show yet, so the screen says so and offers the demo instead.
 */
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Tabs,
  Text,
} from "@radix-ui/themes";

import { formatEur, formatNumber, plural } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { ReturnPreview } from "../model/preview";
import { TAX_YEAR } from "../state/wizard";
import { Note } from "../ui/bits";
import { DividendsPanel } from "./review/DividendsPanel";
import { GainsPanel } from "./review/GainsPanel";
import { NotesPanel } from "./review/NotesPanel";

function Figure({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Flex direction="column" gap="1" className="figure">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text size="6" weight="medium" className="num">
        {value}
      </Text>
    </Flex>
  );
}

export function EmptyReview({
  onStartDemo,
}: {
  readonly onStartDemo: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card size="4" variant="surface">
      <Flex direction="column" align="start" gap="3" className="measure">
        <MagnifyingGlassIcon
          size={28}
          weight="bold"
          aria-hidden
          className="accent-icon"
        />
        <Heading as="h2" size="5">
          {t.review.emptyTitle}
        </Heading>
        <Text as="p" size="3" color="gray">
          {t.review.emptyBody}
        </Text>
        <Button size="3" mt="2" onClick={onStartDemo}>
          {t.start.primaryCta}
        </Button>
      </Flex>
    </Card>
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
  const year = String(preview?.taxYear ?? TAX_YEAR);
  const notes = preview?.diagnostics ?? [];
  const blocking = notes.filter((d) => d.severity === "blocking").length;
  const needAttention = notes.filter((d) => d.severity !== "info").length;
  return (
    <Flex direction="column" gap="6">
      <Box className="measure">
        <Heading as="h1" size="7" mb="2" tabIndex={-1}>
          {t.review.title(year)}
        </Heading>
        <Text as="p" size="3" color="gray">
          {t.review.intro}
        </Text>
      </Box>

      {preview === null ? (
        <EmptyReview onStartDemo={onStartDemo} />
      ) : (
        <>
          <Card size="3" variant="surface">
            <Grid
              columns={{ initial: "1", sm: "2", md: "4" }}
              gap="5"
              className="figures"
            >
              <Figure
                label={t.review.salesLabel}
                value={formatNumber(String(preview.securities.length), locale)}
              />
              <Figure
                label={t.review.gainsTaxLabel}
                value={formatEur(preview.gainsEstimate.taxEur, locale)}
              />
              <Figure
                label={t.review.dividendsLabel}
                value={formatEur(preview.dividendsEstimate.grossEur, locale)}
              />
              <Figure
                label={t.review.dividendsTaxLabel}
                value={formatEur(preview.dividendsEstimate.taxDueEur, locale)}
              />
            </Grid>
            <Text as="p" size="1" color="gray" mt="4">
              {t.review.estimateNote}
            </Text>
          </Card>

          {needAttention === 0 ? null : (
            <Note tone={blocking > 0 ? "red" : "amber"} id="review-attention">
              {plural(needAttention, locale, t.review.attention)}
              {blocking > 0 ? ` ${t.review.blocked}` : ""}
            </Note>
          )}

          <Tabs.Root defaultValue="gains">
            <Tabs.List size={{ initial: "1", sm: "2" }} wrap="wrap">
              <Tabs.Trigger value="gains">{t.review.tabGains}</Tabs.Trigger>
              <Tabs.Trigger value="dividends">
                {t.review.tabDividends}
              </Tabs.Trigger>
              <Tabs.Trigger value="notes">
                {t.review.tabNotes(
                  formatNumber(String(preview.diagnostics.length), locale),
                )}
              </Tabs.Trigger>
            </Tabs.List>
            <Box pt="5">
              <Tabs.Content value="gains">
                <h2 className="visually-hidden">{t.review.tabGains}</h2>
                <GainsPanel
                  securities={preview.securities}
                  estimate={preview.gainsEstimate}
                />
              </Tabs.Content>
              <Tabs.Content value="dividends">
                <h2 className="visually-hidden">{t.review.tabDividends}</h2>
                <DividendsPanel
                  dividends={preview.dividends}
                  totals={preview.dividendsEstimate}
                />
              </Tabs.Content>
              <Tabs.Content value="notes">
                <h2 className="visually-hidden">
                  {t.review.tabNotes(
                    formatNumber(String(preview.diagnostics.length), locale),
                  )}
                </h2>
                <NotesPanel diagnostics={preview.diagnostics} />
              </Tabs.Content>
            </Box>
          </Tabs.Root>
        </>
      )}

      <Flex gap="3">
        <Button size="3" variant="soft" color="gray" onClick={onBack}>
          {t.nav.back}
        </Button>
        {preview === null ? null : (
          <Button
            size="3"
            onClick={onNext}
            disabled={blocking > 0}
            aria-describedby={blocking > 0 ? "review-attention" : undefined}
          >
            {t.nav.next}
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
