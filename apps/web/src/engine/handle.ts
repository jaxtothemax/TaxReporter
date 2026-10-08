/**
 * One request, start to finish, as the engine worker runs it (ADR 0013 §5):
 * the request's files through the pipeline, the result as plain data. Pure
 * but for the rate snapshot, which it is handed, so the tests run it in Node
 * over the broker fixtures; the worker file is a thin shell around it.
 */
import { hasBlocking, type Diagnostic } from "@taxreporter/core";
import {
  isFursCountry,
  isTaxNumber,
  writeDohDiv,
  writeDohKdvp,
  type PayerInfo,
  type Taxpayer,
} from "@taxreporter/furs";
import type { RateTable } from "@taxreporter/fx";
import { buildReturns, readExports } from "@taxreporter/pipeline";

import {
  PROTOCOL_VERSION,
  type EngineReply,
  type EngineRequest,
  type FormOutput,
  type PayerDetails,
  type TaxpayerDetails,
} from "./protocol";
import {
  fileIndex,
  payerPrompts,
  sessionFindings,
  summarize,
  symbolsOf,
  toPreview,
} from "./toPreview";

/** Text as typed, on one line: runs of white space become one space. */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The taxpayer as the forms take it: what was left empty is left out. */
export function taxpayerOf(details: TaxpayerDetails): Taxpayer {
  const optional = (value: string) => {
    const text = tidy(value);
    return text === "" ? undefined : text;
  };
  const fields = {
    name: optional(details.name),
    address: optional(details.address),
    city: optional(details.city),
    postNumber: optional(details.postCode),
    email: optional(details.email),
  };
  return {
    taxNumber: details.taxNumber.replace(/\s+/g, ""),
    ...Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ),
  };
}

/**
 * The payers whose name, address and country are all given. One with any
 * missing is left out, so Doh-Div says which payer it still needs
 * (`payerUnknown`) instead of filing half a payer.
 */
export function payersOf(
  details: readonly PayerDetails[],
): Map<string, PayerInfo> {
  const payers = new Map<string, PayerInfo>();
  for (const payer of details) {
    const name = tidy(payer.name);
    const address = tidy(payer.address);
    const country = payer.country;
    if (name === "" || address === "" || !isFursCountry(country)) continue;
    const id = tidy(payer.id);
    const source = payer.sourceCountry;
    payers.set(payer.isin, {
      name,
      address,
      country,
      // A Slovenian payer is named by its tax number; any other by its ID.
      ...(id === ""
        ? {}
        : country === "SI"
          ? isTaxNumber(id)
            ? { taxNumber: id }
            : {}
          : { identificationNumber: id }),
      ...(isFursCountry(source) ? { sourceCountry: source } : {}),
    });
  }
  return payers;
}

const blocking = (findings: readonly Diagnostic[]) =>
  findings.filter((d) => d.severity === "blocking").length;

export async function handleRequest(
  request: EngineRequest,
  rates: () => Promise<RateTable>,
): Promise<EngineReply> {
  const base = { v: PROTOCOL_VERSION, id: request.id } as const;
  try {
    const names = request.files.map((file) => file.name);
    const read = readExports({
      files: request.files.map((file) => ({
        name: file.name,
        bytes: new Uint8Array(file.bytes),
      })),
      accounts: request.accounts,
    });
    const index = fileIndex(read, names);
    const files = summarize(read, index);
    if (request.kind === "read") {
      return {
        ...base,
        kind: "read",
        files,
        findings: sessionFindings(read.ledger.diagnostics, files, index),
        payers: payerPrompts(read.ledger.events, request.taxYear),
        symbols: symbolsOf(read.ledger.events),
      };
    }
    const payers = payersOf(request.payers);
    const prepared = buildReturns(read, {
      taxYear: request.taxYear,
      taxpayer: taxpayerOf(request.taxpayer),
      rates: await rates(),
      payers,
    });
    const { kdvp, div, ledger } = prepared;
    // A finding from reading the files can bear on either return, so it
    // withholds both; a builder's own withholds only its form (ADR 0013 §9).
    const fromLedger = blocking(ledger.diagnostics);
    const kdvpBlocking = fromLedger + blocking(kdvp.diagnostics);
    const divBlocking = fromLedger + blocking(div.diagnostics);
    const kdvpOut: FormOutput = {
      xml:
        kdvp.form === null || hasBlocking(kdvp.diagnostics)
          ? null
          : writeDohKdvp(kdvp.form),
      blocking: kdvpBlocking,
      needed: kdvp.lists.length > 0 || kdvpBlocking > 0,
    };
    const divOut: FormOutput = {
      xml:
        div.form === null || hasBlocking(div.diagnostics)
          ? null
          : writeDohDiv(div.form),
      blocking: divBlocking,
      needed: div.dividends.length > 0 || divBlocking > 0,
    };
    const payerNames = new Map(
      [...payers].map(([isin, payer]) => [isin, payer.name]),
    );
    return {
      ...base,
      kind: "prepare",
      files,
      preview: toPreview(prepared, request.taxYear, payerNames, index, files),
      kdvp: kdvpOut,
      div: divOut,
    };
  } catch {
    // No detail crosses: an error's message could hold text from a file.
    return { ...base, kind: "failed" };
  }
}
