/**
 * Download and import. The XML writer does not exist yet, so the download
 * buttons are disabled with the reason shown next to them, never hidden. A
 * form with nothing in it gets no card: there is nothing to file.
 */
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import {
  Box,
  Button,
  Card,
  Code,
  Flex,
  Grid,
  Heading,
  Text,
} from "@radix-ui/themes";

import { formatDate, plural } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { ReturnPreview } from "../model/preview";
import { Note } from "../ui/bits";

/**
 * 28 February, moved to the next working day when it is not one (ZDavP-2
 * Art. 45(2)); for tax year 2026 that is Monday 1 March 2027
 * (docs/research/04-si-tax-rules.md).
 */
export function filingDeadline(taxYear: number): string {
  const due = new Date(Date.UTC(taxYear + 1, 1, 28));
  const day = due.getUTCDay();
  if (day === 6) due.setUTCDate(due.getUTCDate() + 2);
  if (day === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}

function FormCard({
  form,
  body,
  fileName,
}: {
  readonly form: string;
  readonly body: string;
  readonly fileName: string;
}) {
  const { t } = useI18n();
  return (
    <Card size="3" variant="surface">
      <Flex direction="column" gap="3" height="100%">
        <Heading as="h2" size="5">
          {form}
        </Heading>
        <Text as="p" size="3" color="gray">
          {body}
        </Text>
        <Code variant="ghost" size="2">
          {fileName}
        </Code>
        <Box mt="auto" pt="2">
          <Button size="3" disabled aria-describedby="download-not-built">
            <DownloadSimpleIcon size={18} weight="bold" aria-hidden />
            {t.download.downloadButton(form)}
          </Button>
        </Box>
      </Flex>
    </Card>
  );
}

export function DownloadStep({
  preview,
  onBack,
  onRestart,
}: {
  readonly preview: ReturnPreview;
  readonly onBack: () => void;
  readonly onRestart: () => void;
}) {
  const { locale, t } = useI18n();
  const deadline = formatDate(filingDeadline(preview.taxYear), locale);
  const year = String(preview.taxYear);
  return (
    <Flex direction="column" gap="6">
      <Box className="measure">
        <Heading as="h1" size="7" mb="2" tabIndex={-1}>
          {t.download.title}
        </Heading>
        <Text as="p" size="3" color="gray">
          {t.download.intro(deadline)}
        </Text>
      </Box>

      <Grid columns={{ initial: "1", sm: "2" }} gap="4">
        {preview.securities.length === 0 ? null : (
          <FormCard
            form={t.download.kdvpTitle}
            body={plural(
              preview.securities.length,
              locale,
              t.download.kdvpBody,
            )}
            fileName={`Doh-KDVP-${year}.xml`}
          />
        )}
        {preview.dividends.length === 0 ? null : (
          <FormCard
            form={t.download.divTitle}
            body={plural(preview.dividends.length, locale, t.download.divBody)}
            fileName={`Doh-Div-${year}.xml`}
          />
        )}
      </Grid>

      <Note tone="gray" id="download-not-built">
        {t.download.notBuilt}
      </Note>

      <Box className="measure">
        <Heading as="h2" size="5" mb="3">
          {t.download.importTitle}
        </Heading>
        <ol className="import-steps">
          {t.download.importSteps(deadline).map((step) => (
            <li key={step}>
              <Text size="3">{step}</Text>
            </li>
          ))}
        </ol>
      </Box>

      <Flex gap="3">
        <Button size="3" variant="soft" color="gray" onClick={onBack}>
          {t.nav.back}
        </Button>
        <Button size="3" variant="soft" color="gray" onClick={onRestart}>
          <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
          {t.download.startOver}
        </Button>
      </Flex>
    </Flex>
  );
}
