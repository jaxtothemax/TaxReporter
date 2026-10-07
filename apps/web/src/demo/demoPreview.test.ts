/**
 * Recomputes every derived figure of the demo data from its inputs, in exact
 * rational arithmetic, so the demo can never show a number that does not
 * follow from the rules it claims (see the header of demoPreview.ts).
 */
import { describe, expect, it } from "vitest";

import {
  HOLDING_BUCKETS,
  type HoldingBucket,
  type KdvpRow,
  type SecurityResult,
} from "../model/preview";
import { demoPreview } from "./demoPreview";

// ─── Exact rationals over BigInt ────────────────────────────────────────────

interface Q {
  readonly n: bigint;
  readonly d: bigint;
}

const q = (s: string): Q => {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (m === null) throw new Error(`bad decimal ${s}`);
  const frac = m[3] ?? "";
  const n = BigInt(`${m[2] ?? "0"}${frac}`) * (m[1] === "-" ? -1n : 1n);
  return { n, d: 10n ** BigInt(frac.length) };
};
const add = (a: Q, b: Q): Q => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const sub = (a: Q, b: Q): Q => add(a, { n: -b.n, d: b.d });
const mul = (a: Q, b: Q): Q => ({ n: a.n * b.n, d: a.d * b.d });
const div = (a: Q, b: Q): Q =>
  b.n < 0n ? { n: -a.n * b.d, d: a.d * -b.n } : { n: a.n * b.d, d: a.d * b.n };
const cmp = (a: Q, b: Q): number => {
  const diff = a.n * b.d - b.n * a.d;
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
};
const min = (...xs: Q[]): Q => xs.reduce((a, b) => (cmp(a, b) <= 0 ? a : b));
const ZERO = q("0");
const sum = (xs: Q[]): Q => xs.reduce(add, ZERO);

/** Rounds half away from zero to `scale` decimals and prints a plain decimal. */
function round(x: Q, scale: number): string {
  const unit = 10n ** BigInt(scale);
  const negative = x.n < 0n;
  const num = (negative ? -x.n : x.n) * unit;
  let r = num / x.d;
  if ((num % x.d) * 2n >= x.d) r += 1n;
  const digits = r.toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative && r !== 0n ? "-" : ""}${int}${scale > 0 ? `.${frac}` : ""}`;
}
const r2 = (x: Q) => round(x, 2);
const r8 = (x: Q) => round(x, 8);

// ─── Rules under test ───────────────────────────────────────────────────────

/** Completed years between two ISO dates. */
function completedYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

function bucketFor(years: number): HoldingBucket {
  return years >= 15 ? "0" : years >= 10 ? "15" : years >= 5 ? "20" : "25";
}

/** EUR per unit: BSI rates are units per 1 EUR, so EUR = amount / rate. */
function eurPerUnit(row: KdvpRow): string {
  return row.rate === null
    ? r8(q(row.price.amount))
    : r8(div(q(row.price.amount), q(row.rate.rate)));
}

/** FIFO across every purchase of the security, whichever broker it came from. */
function fifo(
  security: SecurityResult,
): { purchaseDate: string; quantity: string }[] {
  const lots = security.rows
    .filter((r) => r.kind === "purchase")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date, left: q(r.quantity) }));
  const matched: { purchaseDate: string; quantity: string }[] = [];
  for (const sale of security.rows.filter((r) => r.kind === "sale")) {
    let need = q(sale.quantity);
    for (const lot of lots) {
      if (cmp(need, ZERO) === 0) break;
      if (cmp(lot.left, ZERO) === 0) continue;
      const take = min(lot.left, need);
      lot.left = sub(lot.left, take);
      need = sub(need, take);
      matched.push({ purchaseDate: lot.date, quantity: round(take, 8) });
    }
    expect(cmp(need, ZERO), `${security.symbol}: sale exceeds purchases`).toBe(
      0,
    );
  }
  return matched;
}

const same = (a: string, b: string) => cmp(q(a), q(b)) === 0;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("demo securities", () => {
  for (const security of demoPreview.securities) {
    describe(security.symbol, () => {
      it("converts every row at its own rate, to 8 decimals", () => {
        for (const row of security.rows) {
          expect(row.priceEur, `${row.kind} ${row.date}`).toBe(eurPerUnit(row));
          if (row.rate !== null) {
            expect(row.rate.listDate <= row.date).toBe(true);
          }
        }
      });

      it("matches sales to purchases first in, first out across brokers", () => {
        const expected = fifo(security);
        expect(security.lots.map((l) => l.purchaseDate)).toEqual(
          expected.map((l) => l.purchaseDate),
        );
        security.lots.forEach((lot, i) => {
          expect(same(lot.quantity, expected[i]?.quantity ?? "x")).toBe(true);
        });
      });

      it("derives each lot's values, gain, normed costs and bucket", () => {
        for (const lot of security.lots) {
          const buy = security.rows.find(
            (r) => r.kind === "purchase" && r.date === lot.purchaseDate,
          );
          const sell = security.rows.find(
            (r) => r.kind === "sale" && r.date === lot.saleDate,
          );
          if (buy === undefined || sell === undefined)
            throw new Error("lot without its rows");
          const acquisition = r2(mul(q(lot.quantity), q(buy.priceEur)));
          const disposal = r2(mul(q(lot.quantity), q(sell.priceEur)));
          expect(lot.acquisitionEur).toBe(acquisition);
          expect(lot.disposalEur).toBe(disposal);
          const gain = sub(q(disposal), q(acquisition));
          expect(same(lot.gainEur, r2(gain))).toBe(true);
          // Normed costs only reduce a positive gain, and never below zero.
          const normed =
            cmp(gain, ZERO) > 0
              ? min(
                  q(r2(mul(q("0.01"), add(q(acquisition), q(disposal))))),
                  gain,
                )
              : ZERO;
          expect(same(lot.normedCostsEur, r2(normed))).toBe(true);
          expect(lot.yearsHeld).toBe(
            completedYears(lot.purchaseDate, lot.saleDate),
          );
          expect(lot.bucket).toBe(bucketFor(lot.yearsHeld));
        }
      });

      it("totals its lots", () => {
        const proceeds = sum(security.lots.map((l) => q(l.disposalEur)));
        const cost = sum(security.lots.map((l) => q(l.acquisitionEur)));
        expect(same(security.proceedsEur, r2(proceeds))).toBe(true);
        expect(same(security.costEur, r2(cost))).toBe(true);
        expect(same(security.gainEur, r2(sub(proceeds, cost)))).toBe(true);
        const sold = sum(
          security.rows
            .filter((r) => r.kind === "sale")
            .map((r) => q(r.quantity)),
        );
        expect(same(security.quantitySold, round(sold, 8))).toBe(true);
      });
    });
  }
});

describe("demo gains estimate", () => {
  const lots = demoPreview.securities.flatMap((s) => s.lots);
  const bases = lots.map((l) => ({
    bucket: l.bucket,
    base: sub(q(l.gainEur), q(l.normedCostsEur)),
  }));
  const positive = (b: HoldingBucket) =>
    sum(
      bases
        .filter((x) => x.bucket === b && cmp(x.base, ZERO) > 0)
        .map((x) => x.base),
    );
  const totalPositive = sum(HOLDING_BUCKETS.map(positive));
  const losses = sum(
    bases.filter((x) => cmp(x.base, ZERO) < 0).map((x) => x.base),
  );
  const net = add(totalPositive, losses);
  const { gainsEstimate: e } = demoPreview;

  it("sums positive bases per bucket and offsets the year's losses", () => {
    for (const b of HOLDING_BUCKETS) {
      expect(same(e.positiveByBucket[b], r2(positive(b))), b).toBe(true);
    }
    expect(same(e.lossesEur, r2(losses))).toBe(true);
    expect(same(e.netBaseEur, r2(net))).toBe(true);
  });

  it("splits the net base pro rata across buckets and applies each rate", () => {
    const share = (b: HoldingBucket) =>
      div(mul(net, positive(b)), totalPositive);
    for (const b of HOLDING_BUCKETS) {
      expect(same(e.allocatedByBucket[b], r2(share(b))), b).toBe(true);
    }
    const tax = sum(
      HOLDING_BUCKETS.map((b) => mul(share(b), q(`0.${b.padStart(2, "0")}`))),
    );
    expect(e.taxEur).toBe(r2(tax));
  });
});

describe("demo dividends", () => {
  it("converts each payment at its own date's rate and caps the credit", () => {
    for (const row of demoPreview.dividends) {
      const toEur = (amount: string) =>
        row.rate === null ? q(amount) : div(q(amount), q(row.rate.rate));
      expect(row.grossEur, `${row.symbol} ${row.date}`).toBe(
        r2(toEur(row.gross.amount)),
      );
      expect(row.foreignTaxEur).toBe(r2(toEur(row.foreignTax.amount)));
      const slovenianTax = q(r2(mul(q("0.25"), q(row.grossEur))));
      const treatyCap =
        row.treatyRate === null
          ? ZERO
          : q(r2(mul(q(row.treatyRate), q(row.grossEur))));
      expect(
        same(
          row.creditEur,
          r2(min(q(row.foreignTaxEur), treatyCap, slovenianTax)),
        ),
      ).toBe(true);
      if (row.rate !== null) expect(row.rate.listDate <= row.date).toBe(true);
    }
  });

  it("totals the payments and the tax still due", () => {
    const rows = demoPreview.dividends;
    const d = demoPreview.dividendsEstimate;
    expect(same(d.grossEur, r2(sum(rows.map((r) => q(r.grossEur)))))).toBe(
      true,
    );
    expect(
      same(d.foreignTaxEur, r2(sum(rows.map((r) => q(r.foreignTaxEur))))),
    ).toBe(true);
    expect(same(d.creditEur, r2(sum(rows.map((r) => q(r.creditEur)))))).toBe(
      true,
    );
    const due = sum(
      rows.map((r) =>
        sub(q(r2(mul(q("0.25"), q(r.grossEur)))), q(r.creditEur)),
      ),
    );
    expect(same(d.taxDueEur, r2(due))).toBe(true);
  });
});

describe("demo diagnostics", () => {
  it("state the excess withholding exactly as the dividend row computes it", () => {
    const note = demoPreview.diagnostics.find(
      (d) => d.code === "excessWithholding",
    );
    const row = demoPreview.dividends.find((r) => r.payer === "Allianz SE");
    if (note?.code !== "excessWithholding" || row === undefined)
      throw new Error("missing");
    expect(note.params.creditEur).toBe(row.creditEur);
    expect(note.params.withheldEur).toBe(row.foreignTaxEur);
    expect(
      same(
        note.params.excessEur,
        r2(sub(q(row.foreignTaxEur), q(row.creditEur))),
      ),
    ).toBe(true);
  });

  it("explain the holiday rate with the list the row actually used", () => {
    const note = demoPreview.diagnostics.find((d) => d.code === "holidayRate");
    if (note?.code !== "holidayRate") throw new Error("missing");
    const row = demoPreview.dividends.find((r) => r.date === note.params.date);
    expect(row?.rate?.listDate).toBe(note.params.listDate);
    expect(note.params.listDate < note.params.date).toBe(true);
  });

  it("mention every split that adjusted a row", () => {
    const notes = demoPreview.diagnostics.filter(
      (d) => d.code === "splitAdjusted",
    );
    const adjusted = demoPreview.securities.flatMap((s) =>
      s.rows.filter((r) => r.splitAdjusted !== undefined).map(() => s.symbol),
    );
    expect(notes.map((n) => n.params.symbol)).toEqual(adjusted);
  });
});
