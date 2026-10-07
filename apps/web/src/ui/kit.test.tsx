import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Locale } from "../i18n/format";
import { I18nProvider } from "../i18n/i18n";
import {
  barFractions,
  CompareBars,
  MonthBars,
  shareFractions,
  StackBar,
} from "./charts";
import {
  Amount,
  Button,
  DataTable,
  DeltaPill,
  hueOf,
  Note,
  SecurityMark,
  Tabs,
  TICKER_HUES,
  tabTarget,
} from "./kit";
import { LOGOS } from "./logos";

function render(node: ReactNode, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

describe("Button", () => {
  it("never submits a form unless asked to", () => {
    expect(render(<Button>Go</Button>)).toContain('type="button"');
    expect(render(<Button type="submit">Go</Button>)).toContain(
      'type="submit"',
    );
  });
});

describe("Amount", () => {
  it("styles the cents apart but gives screen readers the amount in one piece", () => {
    const html = render(<Amount value="1770.04" />);
    expect(html).toMatch(
      /<span aria-hidden="true" class="amount-parts"><span class="amount-currency">€<\/span><span class="amount-main">1,770<\/span><span class="amount-cents">\.04<\/span><\/span>/,
    );
    expect(html).toContain('<span class="visually-hidden">€1,770.04</span>');
  });

  it("marks a loss, and a signed gain, by more than color", () => {
    expect(render(<Amount value="-427.50" />)).toContain("is-loss");
    const gain = render(<Amount value="8304.21" signed />);
    expect(gain).toContain("is-gain");
    expect(text(gain)).toContain("+€8,304.21");
    expect(render(<Amount value="0.00" signed />)).not.toContain("is-gain");
  });
});

describe("DeltaPill", () => {
  it("rises for a gain, falls for a loss, and stays flat at zero", () => {
    expect(render(<DeltaPill value="5820.32" />)).toContain("delta-up");
    const loss = render(<DeltaPill value="-427.50" />, "sl");
    expect(loss).toContain("delta-down");
    expect(text(loss)).toContain("−427,50 €");
    const flat = render(<DeltaPill value="0.00" />);
    expect(flat).toContain("delta-flat");
    expect(flat).not.toContain("<svg");
  });
});

describe("hueOf", () => {
  it("gives a symbol the same hue every time, inside the band with no status meaning", () => {
    expect(hueOf("AAPL")).toBe(hueOf("AAPL"));
    expect(hueOf("AAPL")).not.toBe(hueOf("NVDA"));
    // Cyan to violet: clear of amber warnings, emerald gains and rose losses.
    expect(TICKER_HUES.from).toBeGreaterThanOrEqual(180);
    expect(TICKER_HUES.from + TICKER_HUES.span).toBeLessThanOrEqual(310);
    for (const symbol of ["A", "O", "T", "ULVR", "VWCE", "ASML", "€uro", ""]) {
      expect(hueOf(symbol)).toBeGreaterThanOrEqual(TICKER_HUES.from);
      expect(hueOf(symbol)).toBeLessThan(TICKER_HUES.from + TICKER_HUES.span);
    }
  });
});

/** ISO 6166 check digit. */
function isIsin(value: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value)) return false;
  let digits = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    digits += code >= 65 ? String(code - 55) : value.charAt(i);
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits.charAt(i));
    if (double) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

describe("logos", () => {
  it("are keyed by valid ISINs and hold only path data and a color", () => {
    const entries = Object.entries(LOGOS);
    expect(entries.length).toBeGreaterThan(20);
    for (const [isin, logo] of entries) {
      expect(isIsin(isin), isin).toBe(true);
      expect(logo.color).toMatch(/^#[0-9A-F]{6}$/);
      expect(logo.path).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
    }
  });

  it("show a company's logo where one ships, and the ticker tile otherwise", () => {
    const apple = render(<SecurityMark isin="US0378331005" symbol="AAPL" />);
    expect(apple).toContain('class="logo"');
    expect(apple).toContain("<path d=");
    expect(apple).toContain('aria-hidden="true"');
    const fund = render(<SecurityMark isin="IE00BK5BQT80" symbol="VWCE" />);
    expect(fund).toContain('class="ticker"');
    expect(fund).toContain(">VWCE<");
  });

  it("name the symbol for screen readers only when asked", () => {
    expect(
      render(<SecurityMark isin="US0378331005" symbol="AAPL" labelled />),
    ).toContain('<span class="visually-hidden">AAPL</span>');
    expect(
      render(<SecurityMark isin="US0378331005" symbol="AAPL" />),
    ).not.toContain("visually-hidden");
  });
});

describe("Note", () => {
  it("puts the id on the message, not on the action next to it", () => {
    const html = render(
      <Note tone="warn" id="msg" action={<Button>Act</Button>}>
        Check this.
      </Note>,
    );
    expect(html).toMatch(/<div class="note-body" id="msg">Check this\.<\/div>/);
    expect(html).toContain('role="note"');
  });
});

describe("DataTable", () => {
  it("wraps the table in a named scroller that takes keyboard focus", () => {
    const html = render(
      <DataTable caption="Lots">
        <tbody>
          <tr>
            <td>1</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    expect(html).toMatch(
      /^<div class="table-scroll" role="region" aria-label="Lots" tabindex="0"><table class="table"><caption class="visually-hidden">Lots<\/caption>/,
    );
  });
});

describe("Tabs", () => {
  const html = render(
    <Tabs
      idPrefix="t"
      label="Parts"
      selected="b"
      onSelect={() => undefined}
      items={[
        { id: "a", label: "A", panel: "Panel A" },
        { id: "b", label: "B", panel: "Panel B" },
      ]}
    />,
  );

  it("links each tab to its panel and back", () => {
    expect(html).toContain('id="t-tab-a"');
    expect(html).toContain('aria-controls="t-panel-a"');
    expect(html).toContain('aria-labelledby="t-tab-a"');
  });

  it("keeps only the selected tab in the tab order and its panel visible", () => {
    expect(html).toMatch(/aria-selected="false"[^>]*tabindex="-1"[^>]*>A</);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>B</);
    expect(html).toMatch(/id="t-panel-a"[^>]*hidden=""/);
    expect(html).not.toMatch(/id="t-panel-b"[^>]*hidden=""/);
  });
});

describe("tabTarget", () => {
  it("wraps around with the arrows and jumps with Home and End", () => {
    expect(tabTarget("ArrowRight", 2, 3)).toBe(0);
    expect(tabTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(tabTarget("ArrowRight", 0, 3)).toBe(1);
    expect(tabTarget("Home", 2, 3)).toBe(0);
    expect(tabTarget("End", 0, 3)).toBe(2);
    expect(tabTarget("Enter", 1, 3)).toBeNull();
  });
});

describe("bar geometry", () => {
  it("scales bars to the largest value and never below zero", () => {
    expect(barFractions(["50", "100", "0", "-5"])).toEqual([0.5, 1, 0, 0]);
    expect(barFractions(["0.00", "0.00"])).toEqual([0, 0]);
  });

  it("splits a whole into shares that add up to one", () => {
    const shares = shareFractions(["2863.48", "5270.85"]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(shareFractions(["0", "0"])).toEqual([0, 0]);
  });
});

describe("charts", () => {
  it("names every share of a stacked bar with its amount", () => {
    const html = text(
      render(
        <StackBar
          segments={[
            { key: "a", label: "Share A", value: "2863.48" },
            { key: "b", label: "Share B", value: "5270.85" },
          ]}
        />,
      ),
    );
    expect(html).toContain("Share A €2,863.48");
    expect(html).toContain("Share B €5,270.85");
  });

  it("labels the peak month and lists every paid month for screen readers", () => {
    const months = [
      { month: "2026-01", grossEur: "2.78" },
      { month: "2026-02", grossEur: "0.00" },
      { month: "2026-05", grossEur: "139.74" },
    ];
    const html = render(<MonthBars months={months} />, "sl");
    expect(html).toMatch(/class="month-peak num">139,74\s€</);
    const list = text(html.slice(html.indexOf('<ul class="visually-hidden">')));
    expect(list).toContain("januar: 2,78 €");
    expect(list).toContain("maj: 139,74 €");
    expect(list).not.toContain("februar");
  });

  it("draws comparison bars as valid list markup with their amounts", () => {
    const html = render(
      <CompareBars
        rows={[
          { key: "p", label: "Proceeds", value: "16706.51" },
          { key: "c", label: "Cost", value: "8402.30" },
        ]}
      />,
    );
    expect(html).toMatch(
      /^<dl class="compare"><div class="compare-row bar-0" style="--fill:100\.00%"><dt>Proceeds<\/dt><dd class="num">€16,706\.51<\/dd><\/div>/,
    );
    expect(html).toContain('style="--fill:50.29%"');
  });
});
