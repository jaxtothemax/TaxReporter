/**
 * The review tabs render only the active panel, so the dividends and notes
 * panels are rendered directly here, inside the providers the app gives them.
 */
import { Theme } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoPreview } from "../../demo/demoPreview";
import type { Locale } from "../../i18n/format";
import { I18nProvider } from "../../i18n/i18n";
import { en, sl } from "../../i18n/messages";
import { SourceText } from "../../ui/bits";
import { DownloadStep, filingDeadline } from "../DownloadStep";
import { ReviewStep } from "../ReviewStep";
import { DividendsPanel } from "./DividendsPanel";
import { GainsPanel } from "./GainsPanel";
import { diagnosticText, NotesPanel } from "./NotesPanel";

function render(node: ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <Theme>{node}</Theme>
    </I18nProvider>,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("GainsPanel", () => {
  const html = render(
    <GainsPanel
      securities={demoPreview.securities}
      estimate={demoPreview.gainsEstimate}
    />,
    "sl",
  );

  it("shows every inventory-list row with its rate provenance and source", () => {
    expect(html.match(/<details/g)).toHaveLength(demoPreview.securities.length);
    expect(text(html)).toContain("1 EUR = 1,1188 USD");
    expect(text(html)).toContain("tečajnica BS z dne 14. 8. 2019");
    expect(text(html)).toContain("ibkr-flex-2019-2026.xml, vrstica 14");
  });

  it("shows BSI rates with the digits BSI published", () => {
    // NVDA's sale used 1.1900, which must not shrink to "1,19".
    expect(text(html)).toContain("1 EUR = 1,1900 USD");
  });

  it("says which rows a split adjusted", () => {
    expect(text(html)).toContain(
      "Prilagojeno za delitev 4:1 z dne 31. 8. 2020",
    );
  });

  it("shows a loss as negative and explains the estimate step by step", () => {
    expect(text(html)).toContain("−427,50 €");
    expect(text(html)).toContain(sl.review.netBase);
    expect(text(html)).toContain("1770,04 €");
  });
});

describe("DividendsPanel", () => {
  const html = render(
    <DividendsPanel
      dividends={demoPreview.dividends}
      totals={demoPreview.dividendsEstimate}
    />,
  );

  it("lists one row per payment plus a total", () => {
    expect(html.match(/<tr/g)).toHaveLength(demoPreview.dividends.length + 2);
    expect(text(html)).toContain("€182.59");
  });

  it("lists payments in date order", () => {
    const dates = [
      ...html.matchAll(/<th[^>]*class="[^"]*num nowrap[^"]*"[^>]*>([^<]+)</g),
    ].map((m) => m[1] ?? "");
    expect(dates[0]).toBe("15 Jan 2026");
    expect(dates.at(-1)).toBe("13 Aug 2026");
    expect(dates).toHaveLength(demoPreview.dividends.length);
  });

  it("flags the credit capped at the treaty rate", () => {
    expect(text(html)).toContain("Credit capped at the treaty rate of 15%");
    expect(text(html)).toContain("Germany");
  });

  it("shows the holiday fallback list for the 1 May payment", () => {
    expect(text(html)).toContain("BSI list of 30 Apr 2026");
  });
});

describe("NotesPanel", () => {
  it("groups notes by severity and confirms nothing blocks the download", () => {
    const html = render(<NotesPanel diagnostics={demoPreview.diagnostics} />);
    expect(text(html)).toContain(en.review.noneBlocking);
    expect(text(html)).toContain(en.review.severity.warning);
    expect(text(html)).toContain(en.review.severity.info);
    expect(text(html)).not.toContain(en.review.severity.blocking);
  });

  it("puts a blocking note first and drops the all-clear", () => {
    const html = text(
      render(
        <NotesPanel
          diagnostics={[
            { severity: "blocking", code: "foreignTaxProof", params: {} },
            ...demoPreview.diagnostics,
          ]}
        />,
      ),
    );
    expect(html).not.toContain(en.review.noneBlocking);
    expect(html.indexOf(en.review.severity.blocking)).toBeLessThan(
      html.indexOf(en.review.severity.warning),
    );
  });

  it("writes every demo note as a full sentence in both languages", () => {
    for (const d of demoPreview.diagnostics) {
      for (const [locale, t] of [
        ["en", en],
        ["sl", sl],
      ] as const) {
        const sentence = diagnosticText(d, locale, t);
        expect(sentence).toMatch(/\.$/);
        expect(sentence).not.toMatch(/undefined|NaN|\{|\}/);
      }
    }
    const excess = demoPreview.diagnostics[0];
    if (excess === undefined) throw new Error("no notes");
    expect(diagnosticText(excess, "sl", sl)).toContain("Nemčija");
  });
});

describe("empty and edge states", () => {
  it("says there is nothing to file instead of showing empty tables", () => {
    const gains = text(
      render(
        <GainsPanel securities={[]} estimate={demoPreview.gainsEstimate} />,
      ),
    );
    expect(gains).toContain(en.review.noSales);
    const dividends = text(
      render(
        <DividendsPanel
          dividends={[]}
          totals={demoPreview.dividendsEstimate}
        />,
      ),
    );
    expect(dividends).toContain(en.review.noDividends);
  });

  it("offers no download card for a form with nothing in it", () => {
    const html = text(
      render(
        <DownloadStep
          preview={{ ...demoPreview, dividends: [] }}
          onBack={() => undefined}
          onRestart={() => undefined}
        />,
      ),
    );
    expect(html).toContain("Download Doh-KDVP");
    expect(html).not.toContain("Download Doh-Div");
  });

  it("never groups the digits of a source row number", () => {
    const html = text(
      render(<SourceText source={{ file: "a.csv", row: 1234 }} />),
    );
    expect(html).toContain("a.csv, row 1234");
  });

  it("stops at the review while a note blocks the download", () => {
    const html = render(
      <ReviewStep
        preview={{
          ...demoPreview,
          diagnostics: [
            { severity: "blocking", code: "foreignTaxProof", params: {} },
          ],
        }}
        onBack={() => undefined}
        onNext={() => undefined}
        onStartDemo={() => undefined}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue/);
    expect(text(html)).toContain(en.review.blocked);
  });
});

describe("filingDeadline", () => {
  it("moves 28 February to the next working day", () => {
    expect(filingDeadline(2026)).toBe("2027-03-01"); // Sunday → Monday
    expect(filingDeadline(2025)).toBe("2026-03-02"); // Saturday → Monday
    expect(filingDeadline(2027)).toBe("2028-02-28"); // Monday stays
  });
});
