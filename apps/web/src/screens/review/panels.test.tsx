/**
 * The review panels rendered on their own, inside the provider the app gives
 * them, so each can be checked with edge-case data.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { demoPreview } from "../../demo/demoPreview";
import type { Locale } from "../../i18n/format";
import { I18nProvider } from "../../i18n/i18n";
import { en, sl } from "../../i18n/messages";
import { RateText, SourceText } from "../../ui/bits";
import { DownloadStep, filingDeadline, FormCard } from "../DownloadStep";
import { ReviewStep } from "../ReviewStep";
import { DividendsPanel } from "./DividendsPanel";
import { GainsPanel } from "./GainsPanel";
import { NotesPanel } from "./NotesPanel";

function render(node: ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
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
  const notes = (findings = demoPreview.findings, locale: Locale = "en") =>
    text(
      render(
        <NotesPanel
          findings={findings}
          symbols={demoPreview.symbols}
          fileNames={["trading212-2026.csv", "ibkr.xml"]}
        />,
        locale,
      ),
    );

  it("groups notes by severity and confirms nothing blocks the download", () => {
    const html = notes();
    expect(html).toContain(en.review.noneBlocking);
    expect(html).toContain(en.review.severity.warning);
    expect(html).toContain(en.review.severity.info);
    expect(html).not.toContain(en.review.severity.blocking);
  });

  it("puts a blocking note first and drops the all-clear", () => {
    const html = notes([
      {
        severity: "blocking",
        code: "payerUnknown",
        params: { isin: "US1912161007" },
      },
      ...demoPreview.findings,
    ]);
    expect(html).not.toContain(en.review.noneBlocking);
    expect(html.indexOf(en.review.severity.blocking)).toBeLessThan(
      html.indexOf(en.review.severity.warning),
    );
  });

  it("writes every demo note as a full sentence in both languages", () => {
    for (const locale of ["en", "sl"] as const) {
      const html = notes(demoPreview.findings, locale);
      expect(html).not.toMatch(/undefined|NaN|\{|\}/);
    }
    expect(notes(demoPreview.findings, "sl")).toContain("Nemčija");
    expect(notes()).toContain("ALV (DE0008404005), 8 May 2026:");
  });

  it("names the file and row a note comes from", () => {
    const html = notes([
      {
        severity: "blocking",
        code: "duplicateKeyInFile",
        params: {},
        source: { file: 1, row: 42 },
      },
    ]);
    expect(html).toContain("ibkr.xml, row 42");
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
          demo
          returns={() => new Promise(() => undefined)}
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

  it("stops at the review while a note blocks both returns", () => {
    const html = render(
      <ReviewStep
        preview={{
          ...demoPreview,
          findings: [
            { severity: "blocking", code: "unknownEvent", params: {} },
          ],
        }}
        canContinue={false}
        onBack={() => undefined}
        onNext={() => undefined}
        onStartDemo={() => undefined}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue/);
    expect(text(html)).toContain(en.review.blocked);
  });

  it("goes on with one return while a note stops only the other", () => {
    const html = render(
      <ReviewStep
        preview={{
          ...demoPreview,
          findings: [
            {
              severity: "blocking",
              code: "payerUnknown",
              params: { isin: "US1912161007" },
            },
          ],
        }}
        forms={{
          kdvp: { xml: "<x/>", blocking: 0, needed: true },
          div: { xml: null, blocking: 1, needed: true },
        }}
        canContinue
        onBack={() => undefined}
        onNext={() => undefined}
        onStartDemo={() => undefined}
      />,
    );
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Continue/);
    expect(text(html)).toContain(en.review.blockedOne("Doh-Div"));
  });

  it("says the review is being prepared, then that it failed", () => {
    const at = (status: "preparing" | "failed") =>
      text(
        render(
          <ReviewStep
            preview={null}
            status={status}
            canContinue={false}
            onBack={() => undefined}
            onNext={() => undefined}
            onStartDemo={() => undefined}
          />,
        ),
      );
    expect(at("preparing")).toContain(en.review.preparing);
    expect(at("failed")).toContain(en.review.prepareFailed);
    expect(at("preparing")).not.toContain("Continue");
  });

  it("reminds that foreign tax needs proof, only where tax was withheld", () => {
    const withTax = text(
      render(
        <DividendsPanel
          dividends={demoPreview.dividends}
          totals={demoPreview.dividendsEstimate}
        />,
      ),
    );
    const proof = en.review.foreignTaxProof.split("'")[0] ?? "";
    expect(withTax).toContain(proof);
    const none = text(
      render(
        <DividendsPanel
          dividends={demoPreview.dividends.map((d) => ({
            ...d,
            foreignTaxEur: "0.00",
          }))}
          totals={demoPreview.dividendsEstimate}
        />,
      ),
    );
    expect(none).not.toContain(proof);
  });
});

describe("RateText", () => {
  it("names a legacy currency's fixed euro rate, not a list of a day", () => {
    const html = text(
      render(
        <RateText
          rate={{
            currency: "SIT",
            rate: "239.64",
            listDate: "2006-12-29",
            source: "euro-changeover",
          }}
        />,
      ),
    );
    expect(html).toContain(en.review.rateFixed);
    expect(html).not.toContain("BSI list of");
  });
});

describe("RateText and SourceText", () => {
  it("names the monthly list a currency the daily list lacks is converted at", () => {
    const html = text(
      render(
        <RateText
          rate={{
            currency: "TWD",
            rate: "35.12",
            listDate: "2026-02-01",
            source: "bsi-monthly",
          }}
        />,
      ),
    );
    expect(html).toContain("BSI monthly list of February 2026");
    expect(html).not.toContain("BSI list of");
  });

  it("says which section of a statement a row is in", () => {
    const html = text(
      render(
        <SourceText source={{ file: "ibkr.xml", row: 3, part: "Trades" }} />,
      ),
    );
    expect(html).toContain("ibkr.xml, Trades, row 3");
  });
});

describe("DownloadStep notes", () => {
  const returns = {
    kdvp: { fileName: "Doh_KDVP_2026.xml", xml: "<x/>", blocking: 0 },
    div: { fileName: "Doh_Div_2026.xml", xml: "<y/>", blocking: 0 },
  };
  const step = (demo: boolean) =>
    text(
      render(
        <DownloadStep
          preview={demoPreview}
          demo={demo}
          returns={returns}
          onBack={() => undefined}
          onRestart={() => undefined}
        />,
      ),
    );

  it("warns never to import the demo's files", () => {
    expect(step(true)).toContain(
      "These files hold the demo's made-up trades".replace("'", "&#x27;"),
    );
  });

  it("asks the user to check their own returns, and gives no demo warning", () => {
    const own = step(false);
    expect(own).toContain(en.download.ownFiles.split(";")[0] ?? "");
    expect(own).not.toContain("made-up trades");
    // Written already: the buttons are ready at once.
    expect(own).toContain(en.download.readyChip);
  });
});

describe("NotesPanel with many notes", () => {
  it("shows the first of each severity and says how many more there are", () => {
    const many = Array.from({ length: 130 }, () => ({
      severity: "info" as const,
      code: "fundFromName" as const,
      params: { isin: "IE00BK5BQT80" },
    }));
    const html = text(
      render(
        <NotesPanel findings={many} omitted={7} symbols={{}} fileNames={[]} />,
      ),
    );
    expect(html.match(/marked as a fund/g)).toHaveLength(100);
    expect(html).toContain("30 more notes are not shown.");
    expect(html).toContain("7 more notes are not shown.");
  });
});

describe("filingDeadline", () => {
  it("moves 28 February to the next working day", () => {
    expect(filingDeadline(2026)).toBe("2027-03-01"); // Sunday → Monday
    expect(filingDeadline(2025)).toBe("2026-03-02"); // Saturday → Monday
    expect(filingDeadline(2027)).toBe("2028-02-28"); // Monday stays
  });
});

describe("FormCard", () => {
  const card = (built: Parameters<typeof FormCard>[0]["built"]) =>
    render(
      <FormCard
        id="kdvp"
        form="Doh-KDVP"
        body="4 lists"
        fileName="Doh_KDVP_2026.xml"
        built={built}
      />,
    );

  it("offers a written return for saving", () => {
    const html = card({
      fileName: "Doh_KDVP_2026.xml",
      xml: "<Envelope/>",
      blocking: 0,
    });
    expect(html).toMatch(/<button[^>]*>[^]*?Download Doh-KDVP/);
    expect(html).not.toContain("aria-disabled");
    expect(text(html)).toContain(en.download.readyChip);
  });

  it("says why a return was not written, beside its disabled button", () => {
    const html = card({
      fileName: "Doh_KDVP_2026.xml",
      xml: null,
      blocking: 2,
    });
    expect(html).toContain('aria-describedby="kdvp-not-written"');
    expect(text(html)).toContain(
      "Not written: 2 problems in the review must be fixed first.",
    );
  });
});
