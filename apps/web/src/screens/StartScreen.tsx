/**
 * The landing screen. Its preview card is a real component rendering a real
 * row of the demo data (the Apple sale), not a picture of the UI.
 */
import {
  ArrowRightIcon,
  DownloadSimpleIcon,
  FilesIcon,
  IdentificationCardIcon,
  ListChecksIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Section,
  Separator,
  Text,
} from "@radix-ui/themes";

import type { ReactNode } from "react";

import { demoPreview } from "../demo/demoPreview";
import { formatDate, formatMoney, formatNumber } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import { Eur, RateText } from "../ui/bits";

/**
 * Keeps form names such as "Doh-KDVP" on one line: a line break at their
 * hyphen makes one name read as two words.
 */
export function keepFormNamesWhole(text: string): ReactNode[] {
  return text.split(/(Doh-[A-Za-z]+)/).map((part, i) =>
    part.startsWith("Doh-") ? (
      <span key={i} className="nowrap">
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

function PreviewCard() {
  const { locale, t } = useI18n();
  const apple = demoPreview.securities.find((s) => s.symbol === "AAPL");
  const sale = apple?.rows.find((r) => r.kind === "sale");
  if (apple === undefined || sale === undefined) return null;
  return (
    <figure className="preview-figure">
      <Card size="3" variant="surface" className="preview-card">
        <Flex direction="column" gap="4">
          <Flex justify="between" align="start" gap="3">
            <Box>
              <Text as="p" size="2" color="gray">
                {t.start.previewSaleOn(formatDate(sale.date, locale))}
              </Text>
              <Text as="p" size="5" weight="bold">
                {apple.name}
              </Text>
            </Box>
            <Badge color="gray" variant="soft" className="mono">
              {apple.isin}
            </Badge>
          </Flex>
          <Separator size="4" />
          <Grid columns="2" gapX="5" gapY="4">
            <Box>
              <Text as="p" size="1" color="gray">
                {t.review.colQuantity}
              </Text>
              <Text size="3" className="num">
                {formatNumber(sale.quantity, locale, { maxFraction: 8 })}
              </Text>
            </Box>
            <Box>
              <Text as="p" size="1" color="gray">
                {t.review.colPrice}
              </Text>
              <Text size="3" className="num">
                {formatMoney(sale.price.amount, sale.price.currency, locale)}
              </Text>
            </Box>
            <Box>
              <Text as="p" size="1" color="gray">
                {t.review.colRate}
              </Text>
              <RateText rate={sale.rate} />
            </Box>
            <Box>
              <Text as="p" size="1" color="gray">
                {t.review.colEurPerUnit}
              </Text>
              <Text size="3" className="num">
                {formatNumber(sale.priceEur, locale, {
                  minFraction: 2,
                  maxFraction: 8,
                })}
              </Text>
            </Box>
          </Grid>
          <Separator size="4" />
          <Flex justify="between" align="baseline">
            <Text size="2" color="gray">
              {t.review.colProceeds}
            </Text>
            <Text size="5">
              <Eur value={apple.proceedsEur} strong />
            </Text>
          </Flex>
        </Flex>
      </Card>
      <figcaption>
        <Text size="2" color="gray">
          {t.start.previewCaption}
        </Text>
      </figcaption>
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
  const { t } = useI18n();
  return (
    <>
      <Section size={{ initial: "2", md: "3" }}>
        <Container size="4" px={{ initial: "4", md: "6" }}>
          <Grid
            columns={{ initial: "1", md: "7fr 5fr" }}
            gap={{ initial: "7", md: "9" }}
            align="center"
          >
            <Flex direction="column" gap="5">
              <Text size="2" weight="medium" className="eyebrow">
                {t.start.eyebrow}
              </Text>
              <Heading
                as="h1"
                tabIndex={-1}
                size={{ initial: "7", md: "8" }}
                className="hero-title"
              >
                {keepFormNamesWhole(t.start.title)}
              </Heading>
              <Text
                as="p"
                size={{ initial: "3", md: "4" }}
                color="gray"
                className="hero-subtitle"
              >
                {t.start.subtitle}
              </Text>
              <Flex gap="3" wrap="wrap" pt="2">
                <Button size="3" onClick={onStartDemo}>
                  {t.start.primaryCta}
                  <ArrowRightIcon size={18} weight="bold" aria-hidden />
                </Button>
                <Button
                  size="3"
                  variant="soft"
                  color="gray"
                  onClick={onStartOwn}
                >
                  {t.start.secondaryCta}
                </Button>
              </Flex>
            </Flex>
            <PreviewCard />
          </Grid>
        </Container>
      </Section>

      <Section size="2">
        <Container size="4" px={{ initial: "4", md: "6" }}>
          <Heading as="h2" size="6" mb="6">
            {t.start.howTitle}
          </Heading>
          <ol className="how-list" role="list">
            {t.start.steps.map((step, i) => {
              const Icon = STEP_ICONS[i] ?? FilesIcon;
              return (
                <li key={step.title}>
                  <span className="how-icon" aria-hidden>
                    <Icon size={22} weight="bold" />
                  </span>
                  <Box>
                    <Heading as="h3" size="4" mb="1">
                      {step.title}
                    </Heading>
                    <Text as="p" size="3" color="gray">
                      {step.body}
                    </Text>
                  </Box>
                </li>
              );
            })}
          </ol>
        </Container>
      </Section>

      <Section size="2">
        <Container size="4" px={{ initial: "4", md: "6" }}>
          <Card size="4" variant="surface">
            <Flex gap="5" direction={{ initial: "column", sm: "row" }}>
              <span className="privacy-icon" aria-hidden>
                <ShieldCheckIcon size={28} weight="bold" />
              </span>
              <Flex direction="column" gap="3" className="measure">
                <Heading as="h2" size="6">
                  {t.start.privacyTitle}
                </Heading>
                <Text as="p" size="3">
                  {t.start.privacyBody}
                </Text>
                <Text as="p" size="2" color="gray">
                  {t.start.privacyLlm}
                </Text>
              </Flex>
            </Flex>
          </Card>
        </Container>
      </Section>

      <Section size="2">
        <Container size="4" px={{ initial: "4", md: "6" }}>
          <Flex direction="column" gap="2" className="measure">
            <Heading as="h2" size="6">
              {t.start.brokersTitle}
            </Heading>
            <Text as="p" size="3">
              {t.start.brokersNow}
            </Text>
            <Text as="p" size="3" color="gray">
              {t.start.brokersNext}
            </Text>
          </Flex>
        </Container>
      </Section>
    </>
  );
}
