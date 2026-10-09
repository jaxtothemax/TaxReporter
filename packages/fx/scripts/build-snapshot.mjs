#!/usr/bin/env node
/**
 * Rebuilds packages/fx/data/ from Banka Slovenije's rate history files: the
 * daily list (dtecbs-l.xml, a copy of the ECB reference rates) and the
 * monthly list of other currencies (EksotTecBS-l.xml). ADR 0005.
 *
 *   pnpm --filter "@taxreporter/fx..." build
 *   node packages/fx/scripts/build-snapshot.mjs              # download from bsi.si
 *   node packages/fx/scripts/build-snapshot.mjs --from DIR \
 *     --retrieved 2026-10-07T21:11:00Z                       # files already downloaded
 *
 * The parser and the invariant checks are the package's own (bsi-xml.ts,
 * snapshot.ts); this script only fetches, hashes and writes. Every rate is
 * copied as BSI wrote it; snapshot.json records where each file came from.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  dailyCsv,
  monthlyCsv,
  parseDailyXml,
  parseMonthlyXml,
} from "../dist/index.js";

const SOURCES = {
  daily: {
    url: "https://www.bsi.si/_data/tecajnice/dtecbs-l.xml",
    file: "dtecbs-l.xml",
  },
  monthly: {
    url: "https://www.bsi.si/_data/tecajnice/EksotTecBS-l.xml",
    file: "EksotTecBS-l.xml",
  },
};
// BSI has refused Python's default User-Agent (research 03 §13).
const USER_AGENT =
  "TaxReporter rate snapshot (+https://github.com/jaxtothemax/broker-to-edavki)";
const DATA = new URL("../data/", import.meta.url);

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    retrieved: { type: "string" },
  },
});

async function download(source) {
  const response = await fetch(source.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml" },
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`${source.url}: HTTP ${String(response.status)}`);
  }
  return {
    text: await response.text(),
    lastModified: response.headers.get("last-modified"),
  };
}

/** A saved `curl -D` header file beside a downloaded source, if any. */
function savedLastModified(path) {
  if (!existsSync(path)) return null;
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((header) => /^last-modified:/i.test(header));
  return line === undefined ? null : line.slice(line.indexOf(":") + 1).trim();
}

async function load(source) {
  if (values.from === undefined) return download(source);
  const path = join(values.from, source.file);
  return {
    text: readFileSync(path, "utf8"),
    lastModified: savedLastModified(`${path}.headers`),
  };
}

/** The calendar day in Ljubljana, where BSI publishes. */
function ljubljanaDay(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function previousDay(iso) {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

const retrieved =
  values.retrieved === undefined ? new Date() : new Date(values.retrieved);
if (Number.isNaN(retrieved.getTime())) throw new Error("bad --retrieved time");

const daily = await load(SOURCES.daily);
const monthly = await load(SOURCES.monthly);
const dailyLists = parseDailyXml(daily.text);
const monthlyLists = parseMonthlyXml(monthly.text);
const dailyText = dailyCsv(dailyLists);
const monthlyText = monthlyCsv(monthlyLists);

const lastList = dailyLists.at(-1)?.date ?? "";
// Every list dated before the retrieval day is certainly in the file; the
// retrieval day's own list may not be published yet. A later date gets
// "afterSnapshot" rather than an older list (rates.ts, RateTable.fromCsv).
const dayBefore = previousDay(ljubljanaDay(retrieved));
const completeThrough = lastList > dayBefore ? lastList : dayBefore;

const sha256 = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const describe = (source, loaded, lists) => ({
  url: source.url,
  lastModified: loaded.lastModified,
  sha256: sha256(loaded.text),
  lists: lists.length,
  first: lists[0]?.validFrom ?? lists[0]?.date,
  last: lists.at(-1)?.validFrom ?? lists.at(-1)?.date,
});

writeFileSync(new URL("bsi-daily.csv", DATA), dailyText);
writeFileSync(new URL("bsi-monthly.csv", DATA), monthlyText);
writeFileSync(
  new URL("snapshot.json", DATA),
  `${JSON.stringify(
    {
      retrievedAt: retrieved.toISOString(),
      completeThrough,
      daily: describe(SOURCES.daily, daily, dailyLists),
      monthly: describe(SOURCES.monthly, monthly, monthlyLists),
    },
    null,
    2,
  )}\n`,
);
console.log(
  `daily ${String(dailyLists.length)} lists to ${lastList}, monthly ${String(monthlyLists.length)} lists; complete through ${completeThrough}`,
);
