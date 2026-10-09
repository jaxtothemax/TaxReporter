/**
 * What the import contract gives every event (ADR 0011), for the builders'
 * tests: keys, file IDs and accounts of the shapes the key builder and
 * intake make, and a broker's clock.
 */
import {
  validateLedger,
  type AccountScope,
  type BrokerTime,
  type EventKey,
  type FileId,
  type LedgerEvent,
  type ValidatedLedger,
} from "@taxreporter/core";

/** A key of the key builder's shape, 128 bits in hex, from a counter. */
export function key(n: number): EventKey {
  return n.toString(16).padStart(32, "0") as EventKey;
}

/** A short ASCII name's character codes in hex. */
function hexOf(name: string): string {
  let hex = "";
  for (let i = 0; i < name.length; i += 1) {
    hex += name.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/** A file ID of intake's shape, from a short name: "a" is "6100000000000000". */
export function fileId(name: string): FileId {
  return hexOf(name).padEnd(16, "0").slice(0, 16) as FileId;
}

/** A Trading 212-style account: its broker and the group number, from 1. */
export function account(broker: string, group = 1): AccountScope {
  return `${broker}:${String(group)}` as AccountScope;
}

/** The clock of a broker that states a date and no time of day. */
export function onDate(date: string): BrokerTime {
  return { instant: null, brokerDate: date };
}

/**
 * The ledger the builders take, from events that have to pass its checks as
 * they are: a test of a builder is never a test of the checks before it.
 */
export function validated(events: readonly LedgerEvent[]): ValidatedLedger {
  const ledger = validateLedger(events);
  if (ledger.diagnostics.length > 0) {
    const codes = ledger.diagnostics.map((d) => d.code).join(", ");
    throw new Error(`The events did not pass validateLedger: ${codes}`);
  }
  return ledger;
}
