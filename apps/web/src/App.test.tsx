/**
 * Server-rendered checks of every screen in both languages. The tests run in
 * Node without a DOM, so interaction is covered by the reducer's tests and
 * these assert what each state renders.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { Locale } from "./i18n/format";
import { en, sl } from "./i18n/messages";
import type { ReadReply } from "./engine/protocol";
import {
  initialWizardState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "./state/wizard";
import {
  engineReplies,
  ownState,
  preparedState,
  TAXPAYER,
} from "./testing/ownFiles";

// The user's own files, as the engine reads and prepares them.
const { read, prepared } = await engineReplies();

function stateAfter(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

function render(state: WizardState, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <App initialLocale={locale} initialState={state} />,
  );
}

/** Visible text with tags stripped and entities decoded, for wording checks. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const demo = stateAfter({ type: "startDemo" });
const screens: [string, WizardState][] = [
  ["start", initialWizardState],
  ["files (demo)", demo],
  ["details (demo)", stateAfter({ type: "startDemo" }, { type: "next" })],
  [
    "review (demo)",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "review" }),
  ],
  [
    "download (demo)",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "download" }),
  ],
];

describe("App", () => {
  for (const [name, state] of screens) {
    for (const locale of ["sl", "en"] as const) {
      it(`renders ${name} in ${locale} without em or en dashes`, () => {
        const html = render(state, locale);
        expect(html.length).toBeGreaterThan(1000);
        expect(text(html)).not.toMatch(/[\u2013\u2014]/);
      });
    }
  }

  it("leads the start screen with the value proposition and both entry points", () => {
    const html = text(render(initialWizardState, "sl"));
    expect(html).toContain(sl.start.title);
    expect(html).toContain(sl.start.primaryCta);
    expect(html).toContain(sl.start.secondaryCta);
    // The preview card is a real row of the demo data with its BSI rate.
    expect(html).toContain("1 EUR = 1,1547 USD");
  });

  it("never groups the digits of a year", () => {
    const review = text(render(screens[3]?.[1] ?? demo, "en"));
    expect(review).toContain("Review tax year 2026");
    expect(text(render(demo, "en"))).toContain("Tax year 2026");
    expect(review).not.toContain("2,026");
  });

  it("keeps each form name on one line in the hero headline", () => {
    const html = render(initialWizardState, "sl");
    expect(html).toMatch(/<span class="[^"]*\bnowrap\b[^"]*">Doh-KDVP<\/span>/);
    expect(html).toMatch(/<span class="[^"]*\bnowrap\b[^"]*">Doh-Div<\/span>/);
  });

  it("starts dark, with a light theme behind a pressed-state toggle", () => {
    const dark = render(initialWizardState);
    expect(dark).toMatch(/<div class="app" data-theme="dark">/);
    expect(dark).toMatch(
      /aria-label="Light theme"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Light theme"/,
    );
    const light = renderToStaticMarkup(
      <App initialState={initialWizardState} initialTheme="light" />,
    );
    expect(light).toMatch(/data-theme="light"/);
    expect(light).toMatch(/aria-pressed="true"/);
  });

  it("offers the languages as native radio buttons named in their own language", () => {
    const html = render(initialWizardState, "sl");
    const radios = html.match(/<input type="radio" name="ui-language"[^>]*>/g);
    expect(radios).toHaveLength(2);
    expect(radios?.[0]).toContain('value="sl"');
    expect(radios?.[0]).toContain("checked");
    expect(radios?.[1]).not.toContain("checked");
    expect(html).toMatch(
      /<span class="visually-hidden" lang="en">[^<]*English<\/span>/,
    );
  });

  it("renders the review as tabs, with every panel present and only one shown", () => {
    const html = render(screens[3]?.[1] ?? demo, "en");
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html.match(/role="tabpanel"[^>]*hidden=""/g)).toHaveLength(2);
  });

  it("marks every flow screen of the demo as demo data", () => {
    for (const [name, state] of screens.slice(1)) {
      expect(text(render(state)), name).toContain(en.demoBanner.body);
    }
    expect(text(render(initialWizardState))).not.toContain(en.demoBanner.body);
  });

  it("previews the XML header from the details as they are typed", () => {
    const state = ownState(
      read,
      { type: "next" },
      { type: "setDetail", field: "taxNumber", value: "1234 5678" },
      { type: "setDetail", field: "name", value: "Ana <&> Novak" },
    );
    const html = render(state);
    // Spaces typed in the tax number are dropped, as the file will have it.
    expect(html).toContain('<span class="xml-value">12345678</span>');
    // Text is escaped, and empty optional fields are left out.
    expect(html).toContain("Ana &lt;&amp;&gt; Novak");
    expect(html).not.toContain("&lt;edp:address1&gt;");
    expect(html).toMatch(
      /<aside class="details-aside" aria-labelledby="details-aside-title">/,
    );
  });

  it("marks the current step for assistive technology", () => {
    const html = render(stateAfter({ type: "startDemo" }, { type: "next" }));
    expect(html).toMatch(/aria-current="step"[^>]*>.*?Details/);
  });

  it("shows the review's headline figures from the demo data", () => {
    const html = text(render(screens[3]?.[1] ?? demo, "en"));
    expect(html).toContain("€1,770.04");
    expect(html).toContain("€182.59");
    expect(html).toContain("€21.33");
    expect(html).toContain("Apple Inc.");
  });

  it("prepares the review of own files, and shows no made-up numbers meanwhile", () => {
    const own = ownState(
      read,
      { type: "setDetail", field: "taxNumber", value: "12345678" },
      { type: "goTo", screen: "review" },
    );
    expect(own.screen).toBe("review");
    const html = text(render(own));
    expect(html).toContain(en.review.preparing);
    expect(html).not.toContain("€1,770.04");
    expect(html).not.toContain(en.demoBanner.body);
  });

  it("lists own files as being read, then by broker and the days they cover", () => {
    const added = stateAfter(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [{ id: "file-1", name: "export.csv", size: 2048 }],
      },
    );
    const reading = text(render(added));
    expect(reading).toContain("export.csv");
    expect(reading).toContain(`2 kB, ${en.files.reading}`);
    expect(reading).toContain(en.files.ownFilesNotice);

    const done = text(render(ownState(read)));
    // From the first dated event to the last: a deposit has no tax date.
    expect(done).toContain("Trading 212, 6 Jan 2026 to 10 Sept 2026, 10 rows");
    expect(done).toMatch(/Interactive Brokers, [^,]+ to [^,]+, \d+ rows/);
    expect(done).not.toContain(en.files.reading);
  });

  it("asks whether the Trading 212 files are one account, preset to one", () => {
    const html = render(ownState(read));
    expect(text(html)).toContain(en.files.accountsTitle);
    const radios =
      html.match(/<input type="radio" name="trading212-accounts"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('value="same"');
    expect(radios[0]).toContain("checked");
    expect(radios[1]).not.toContain("checked");
  });

  it("says why a file cannot be read, beside it, and stops there", () => {
    const refused: ReadReply = {
      ...read,
      files: [
        ...read.files.slice(0, 2),
        {
          status: "refused",
          broker: null,
          firstDate: null,
          lastDate: null,
          rows: 0,
          sameAs: null,
          unnamedAccount: false,
          findings: [
            { severity: "blocking", code: "unknownFormat", params: {} },
          ],
        },
      ],
    };
    const state = ownState(refused, { type: "next" });
    expect(state.screen).toBe("files");
    const html = text(render(state));
    expect(html).toContain("TaxReporter does not recognize this export.");
    expect(html).toContain(en.files.unsupportedBlocked);
  });

  it("asks for each dividend payer, preset from the export", () => {
    const html = render(ownState(read, { type: "next" }));
    expect(text(html)).toContain(en.details.payersTitle);
    expect(html).toMatch(/<legend[^>]*>.*KO.*US1912161007/);
    expect(html).toMatch(/id="payer-US1912161007-name"[^>]*value="Coca-Cola"/);
    expect(html).toMatch(/<option value="US" selected="">/);
    expect(text(html)).toContain(
      "1 payer still needs its details. Until then, Doh-Div is not written; Doh-KDVP is.",
    );
  });

  it("shows the review of own files as the engine prepared it", () => {
    const html = text(render(preparedState(read, prepared)));
    expect(html).toContain("Review tax year 2026");
    expect(html).toContain("US1912161007");
    expect(html).not.toContain(en.review.preparing);
    expect(html).not.toContain(en.demoBanner.body);
  });

  it("offers own returns for download at once, with the user's details in them", () => {
    const state = preparedState(read, prepared, { type: "next" });
    expect(state.screen).toBe("download");
    const html = render(state);
    const buttons =
      html.match(/<button[^>]*>[^]*?Download Doh-(?:KDVP|Div)/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).not.toContain("disabled");
    expect(text(html)).toContain(en.download.ownFiles);
    expect(text(html)).not.toContain(en.download.demoFiles);
    expect(prepared.kdvp.xml).toContain(
      `<edp:taxNumber>${TAXPAYER.taxNumber}</edp:taxNumber>`,
    );
  });

  it("explains a missing file and a missing tax number inline", () => {
    const noFile = stateAfter({ type: "startOwn" }, { type: "next" });
    expect(text(render(noFile))).toContain(en.files.needFiles);

    const badTaxNumber = ownState(read, { type: "next" }, { type: "next" });
    const html = render(badTaxNumber);
    expect(text(html)).toContain(en.details.taxNumberError);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]*details-taxNumber-error/);
  });

  it("never shows a blank Download screen before own returns are prepared", () => {
    const own = ownState(
      read,
      { type: "setDetail", field: "taxNumber", value: "12345678" },
      { type: "goTo", screen: "download" },
    );
    // The review is not prepared, so the jump is refused...
    expect(own.screen).toBe("files");
    // ...and even a forced download state renders a message, not nothing.
    const forced = text(render({ ...own, screen: "download" }));
    expect(forced).toContain(en.review.emptyTitle);
  });

  it("refuses files that are not CSV or XML, and says so", () => {
    const state = stateAfter(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [{ id: "file-1", name: "statement.pdf", size: 9000 }],
      },
      { type: "next" },
    );
    const html = text(render(state));
    expect(state.screen).toBe("files");
    expect(html).toContain(en.files.unsupported);
    expect(html).toContain(en.files.unsupportedBlocked);
  });

  it("lets the demo go on from the review, which nothing blocks", () => {
    const html = render(screens[3]?.[1] ?? demo);
    expect(html).toMatch(/<button[^>]*>Continue/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Continue/);
  });

  it("stops at the review of own files while no return can be written", () => {
    const withheld = {
      ...prepared,
      kdvp: { ...prepared.kdvp, xml: null, blocking: 1 },
      div: { ...prepared.div, xml: null, blocking: 1 },
    };
    const stopped = render(preparedState(read, withheld));
    expect(stopped).toMatch(/<button[^>]*disabled[^>]*>Continue/);
    expect(stopped).toMatch(/aria-describedby="review-attention"/);
    // With one return written, the user goes on to download it.
    const one = { ...withheld, kdvp: prepared.kdvp };
    const going = render(preparedState(read, one));
    expect(going).not.toMatch(/<button[^>]*disabled[^>]*>Continue/);
  });

  it("refuses a file too large to read, unread, and says why", () => {
    const state = stateAfter(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [{ id: "file-1", name: "huge.csv", size: 65 * 1024 * 1024 }],
      },
    );
    const html = text(render(state));
    expect(html).toContain(
      "Larger than any broker export (over 64 MiB), so it is not read.",
    );
  });

  it("says how many files of a large drop it left out", () => {
    const state = stateAfter(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: Array.from({ length: 102 }, (_, i) => ({
          id: `file-${String(i)}`,
          name: `${String(i)}.csv`,
          size: 1,
        })),
      },
    );
    expect(text(render(state))).toContain(
      "2 files were not added. TaxReporter reads at most 100 files at once.",
    );
  });

  it("names each download itself, whatever the engine's reply holds", () => {
    const renamed = {
      ...prepared,
      kdvp: { ...prepared.kdvp, fileName: "evil.html" },
    } as typeof prepared;
    const html = text(render(preparedState(read, renamed, { type: "next" })));
    expect(html).toContain("Doh_KDVP_2026.xml");
    expect(html).not.toContain("evil.html");
  });

  it("keeps the account question, focus and all, while the answer is read", () => {
    const answered = ownState(read, {
      type: "setAccounts",
      accounts: "separate",
    });
    // Read again, so the question's reading is the last one, kept.
    expect(answered.reading.status).toBe("idle");
    const html = render(answered);
    const radios =
      html.match(/<input type="radio" name="trading212-accounts"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios[1]).toContain("checked");
    // The files stay shown as read, not as being read.
    expect(text(html)).toContain("Trading 212, 6 Jan 2026");
  });

  it("caps the problems shown under a file and for the files together", () => {
    const problem = (row: number) => ({
      severity: "blocking" as const,
      code: "duplicateKeyInFile" as const,
      params: {},
      source: { file: 0, row },
    });
    const many: ReadReply = {
      ...read,
      files: [
        {
          ...(read.files[0] as ReadReply["files"][number]),
          findings: Array.from({ length: 5 }, (_, i) => problem(i + 1)),
        },
        ...read.files.slice(1),
      ],
      findings: Array.from({ length: 25 }, (_, i) => problem(i + 100)),
    };
    const html = text(render(ownState(many)));
    expect(html).toContain("2 more notes are not shown.");
    expect(html).toContain("5 more notes are not shown.");
  });

  it("points out the demo's warning above the review tabs", () => {
    const html = text(render(screens[3]?.[1] ?? demo, "en"));
    expect(html).toContain("2 notes need your attention before you download.");
  });

  it("keeps the download buttons disabled while the files are written, and says so", () => {
    const html = render(screens[4]?.[1] ?? demo, "sl");
    const buttons =
      html.match(/<button[^>]*>[^]*?Prenesi Doh-(?:KDVP|Div)/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain("disabled");
    expect(text(html)).toContain(sl.download.preparing);
    expect(text(html)).toContain("Doh_KDVP_2026.xml");
    // Tax year 2026 is due on Monday 1 March 2027 (28 February is a Sunday).
    expect(text(html)).toContain("1. 3. 2027");
  });
});
