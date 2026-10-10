/**
 * Which of a year's returns a refusal from reading the files withholds (ADR
 * 0017): the shape of a takeover paid in shares and free rights booked in
 * one year, and what changes when something they reach is sold.
 */
import { describe, expect, it } from "vitest";

import { fileId, trade } from "../test/events.js";
import {
  diagnostic,
  type Diagnostic,
  type DiagnosticParams,
} from "./diagnostics.js";
import { scopeLedger } from "./reach.js";
import { validateLedger } from "./validate.js";

const OLD = "US00000ORBT1";
const NEW = "US00000NOVA8";
const RIGHTS = "US00000VEGA3";
const OTHER = "US1912161007";

const source = (row: number) => ({ fileId: fileId("t212"), row });

const soldAtZero = (date: string, isin = OLD) =>
  diagnostic(
    "blocking",
    "invalidPrice",
    { isin, date, shares: "out" },
    source(11),
  );

const received = (
  date: string,
  shares: DiagnosticParams["unsupportedAction"]["shares"],
  isin = NEW,
) =>
  diagnostic(
    "blocking",
    "unsupportedAction",
    {
      broker: "trading212",
      action:
        shares === "rights"
          ? "Custom stock distribution"
          : "Stock distribution",
      isin,
      date,
      ...(shares === undefined ? {} : { shares }),
    },
    source(12),
  );

const of = (isin: string) => ({ security: { isin } });

/** Which returns of `year` each finding withholds, by code and row. */
function withheld(
  findings: readonly Diagnostic[],
  events: Parameters<typeof validateLedger>[0],
  year: number,
) {
  const scope = scopeLedger(validateLedger(events, findings), year);
  const label = (d: Diagnostic) => `${d.code}@${String(d.source?.row ?? 0)}`;
  return {
    kdvp: scope.kdvp.map(label),
    div: scope.div.map(label),
    notes: scope.findings
      .filter((d) => d.code === "refusedElsewhere")
      .map(label),
  };
}

describe("a takeover paid in shares", () => {
  // Bought in 2024, exchanged in 2025 (booked as a sale at 0 and new shares
  // received), nothing of either sold in 2026.
  const events = [trade("buy", "2024-04-23", "31", "11.93", of(OLD))];
  const findings = [soldAtZero("2025-09-03"), received("2025-09-03", "in")];

  it("withholds nothing in a later year in which neither security is sold", () => {
    expect(withheld(findings, events, 2026)).toEqual({
      kdvp: [],
      div: [],
      notes: ["refusedElsewhere@11", "refusedElsewhere@12"],
    });
  });

  it("says in its place which row it is, and that the year's returns stand", () => {
    const scope = scopeLedger(validateLedger(events, findings), 2026);
    const notes = [
      diagnostic(
        "info",
        "refusedElsewhere",
        { isin: OLD, date: "2025-09-03", year: "2026", shares: "out" },
        source(11),
      ),
      diagnostic(
        "info",
        "refusedElsewhere",
        { isin: NEW, date: "2025-09-03", year: "2026", shares: "in" },
        source(12),
      ),
    ];
    expect(scope.findings).toEqual(notes);
    // A file's own copy of the same refusals reads the same way, and a
    // finding of another row is left as it is.
    const other = diagnostic("blocking", "invalidIsin", {}, source(13));
    expect(scope.view([...findings, other])).toEqual([...notes, other]);
  });

  it("withholds Doh-KDVP of its own year and of every year the shares were held", () => {
    // The sale at 0 is a disposal of 2025, or of 2024 if a merger counts
    // from its agreement (research 04 §9.1). It is no income.
    expect(withheld(findings, events, 2025)).toEqual({
      kdvp: ["invalidPrice@11"],
      div: ["unsupportedAction@12"],
      notes: [],
    });
    expect(withheld(findings, events, 2024)).toEqual({
      kdvp: ["invalidPrice@11"],
      div: [],
      notes: ["refusedElsewhere@12"],
    });
    expect(withheld(findings, events, 2023)).toEqual({
      kdvp: [],
      div: [],
      notes: ["refusedElsewhere@11", "refusedElsewhere@12"],
    });
  });

  it("withholds every earlier year when no purchase of the old shares is on record", () => {
    expect(withheld([soldAtZero("2025-09-03")], [], 2019).kdvp).toEqual([
      "invalidPrice@11",
    ]);
  });

  it("withholds a later year's Doh-KDVP when either security is sold in it", () => {
    for (const isin of [OLD, NEW]) {
      const later = [
        ...events,
        trade("sell", "2026-05-04", "5", "20", of(isin)),
      ];
      expect(withheld(findings, later, 2026).kdvp).toEqual(
        isin === OLD ? ["invalidPrice@11"] : ["unsupportedAction@12"],
      );
    }
  });

  it("keeps a late booking on the year the event can belong to", () => {
    // Booked on 10 January for an event up to a month earlier: the new
    // shares might be income of the year before (research 06 §4.3).
    const late = [received("2026-01-10", "in")];
    expect(withheld(late, [], 2025).div).toEqual(["unsupportedAction@12"]);
    expect(withheld(late, [], 2026).div).toEqual(["unsupportedAction@12"]);
    expect(withheld(late, [], 2027).div).toEqual([]);
  });
});

describe("rights handed out free", () => {
  const rights = [received("2025-06-24", "rights", RIGHTS)];

  it("withhold Doh-Div of their year, and nothing a year later", () => {
    expect(withheld(rights, [], 2025)).toEqual({
      kdvp: [],
      div: ["unsupportedAction@12"],
      notes: [],
    });
    expect(withheld(rights, [], 2026)).toEqual({
      kdvp: [],
      div: [],
      notes: ["refusedElsewhere@12"],
    });
  });

  it("withhold Doh-KDVP when any security is sold within the 30-day rule's reach", () => {
    // A right to buy counts as acquiring capital of the same kind (art.
    // 97(5)(1)), and the row does not say of which security.
    const near = [trade("sell", "2025-06-13", "5", "20", of(OTHER))];
    expect(withheld(rights, near, 2025).kdvp).toEqual(["unsupportedAction@12"]);
    const far = [trade("sell", "2025-09-30", "5", "20", of(OTHER))];
    expect(withheld(rights, far, 2025).kdvp).toEqual([]);
  });
});

describe("refusals the rule does not scope", () => {
  it("withhold both returns of every year, as before", () => {
    const unscoped = [
      received("2025-09-03", undefined),
      diagnostic("blocking", "invalidPrice", {}, source(13)),
      diagnostic("blocking", "invalidIsin", {}, source(14)),
      // A shape the adapter could not have written: not trusted.
      diagnostic(
        "blocking",
        "invalidPrice",
        { isin: "NOT-AN-ISIN", date: "2025-09-03", shares: "out" },
        source(15),
      ),
      diagnostic(
        "blocking",
        "invalidPrice",
        { isin: OLD, date: "2025-02-30", shares: "out" },
        source(16),
      ),
    ];
    const all = [
      "unsupportedAction@12",
      "invalidPrice@13",
      "invalidIsin@14",
      "invalidPrice@15",
      "invalidPrice@16",
    ];
    expect(withheld(unscoped, [], 2030)).toEqual({
      kdvp: all,
      div: all,
      notes: [],
    });
  });

  it("leave warnings and notes as they are, in their place", () => {
    const moved = diagnostic(
      "warning",
      "dateMovedToLjubljana",
      { date: "2025-09-04", utcDate: "2025-09-03" },
      source(10),
    );
    const scope = scopeLedger(
      validateLedger([], [moved, soldAtZero("2025-09-03")]),
      2026,
    );
    expect(scope.findings.map((d) => d.code)).toEqual([
      "dateMovedToLjubljana",
      "refusedElsewhere",
    ]);
  });
});
