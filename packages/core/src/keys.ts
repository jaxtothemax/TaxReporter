/**
 * Event keys and account scopes: the one place a ledger identity is made
 * (ADR 0011 §4–§5). A key is the first 128 bits of the SHA-256 of a
 * canonical JSON tuple, so the same row read from two overlapping exports
 * gets the same key, two rows of one export never do, and no account or
 * order number survives in it as written. A key is a pseudonym all the same:
 * given a trade's details, its order number can be found by trying them
 * all. So keys, like account scopes, stay on the user's device, in no
 * diagnostic, export or LLM payload.
 *
 * Only this module imports `@noble/hashes`: SHA-256 has to be synchronous,
 * since an adapter's `read` is, and the platform's WebCrypto digest is
 * Promise-only. The known-answer tests in keys.test.ts pin the hash and
 * the encoding, so a dependency bump that changed a key fails CI.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { Decimal } from "./decimal.js";
import type { AccountScope, EventKey, FileId, KeyedEvent } from "./ledger.js";

/**
 * A part of a key: text as the file has it, a whole number, or a Decimal,
 * which enters in canonical form so that "1.50" and "1.5" agree.
 */
export type KeyPart = string | number | Decimal | null;

/** Keys and labels as the tuple's first entry names them; bumped, never edited. */
const KEY_VERSION = "v1";
const ACCOUNT_VERSION = "taxreporter-account-v1";

/** The first 128 bits of the SHA-256 of the text's UTF-8, in lowercase hex. */
export function sha256Prefix(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text))).slice(0, 32);
}

/**
 * A file's ID: the first 64 bits of the SHA-256 of its bytes, in hex. Two
 * files with the same bytes are one file; the name the user gave it stays
 * with the app, never in the pipeline (ADR 0011 §2).
 */
export function fileIdOf(bytes: Uint8Array): FileId {
  return bytesToHex(sha256(bytes)).slice(0, 16) as FileId;
}

/**
 * `sha256Prefix` of the tuple's JSON. `JSON.stringify` escapes a lone
 * surrogate, so two different strings never reach the encoder as the same
 * bytes.
 */
export function digest(tuple: readonly unknown[]): string {
  return sha256Prefix(JSON.stringify(tuple));
}

function canonical(part: KeyPart): string | number | null {
  if (Decimal.isDecimal(part)) return part.toString();
  if (typeof part === "number" && !Number.isSafeInteger(part)) {
    throw new RangeError("A key's number part must be a whole number");
  }
  return part;
}

/** Makes the keys of one file's events. */
export interface KeyBuilder {
  /**
   * The key of an event from its kind and the parts that identify it: the
   * broker's own ID for it where the file has one, else its time, security
   * and amounts. A repeat of the same parts within the file is told apart
   * by its ordinal, the count of earlier ones, which an overlapping export
   * of the same days gives it too.
   */
  key(kind: KeyedEvent["kind"], parts: readonly KeyPart[]): EventKey;
}

/** A key builder for one file: ordinals count within the file only. */
export function keyBuilder(): KeyBuilder {
  // Seen tuples by their digest, so memory stays a few dozen bytes a row.
  const seen = new Map<string, number>();
  return {
    key(kind, parts) {
      const tuple = [KEY_VERSION, kind, ...parts.map(canonical)];
      const id = digest(tuple);
      const ordinal = seen.get(id) ?? 0;
      seen.set(id, ordinal + 1);
      return digest([...tuple, ordinal]) as EventKey;
    },
  };
}

/**
 * The scope of an account a file names, such as IBKR's: the broker and a
 * label hashed from the account's own ID. A pseudonym, not anonymity: an
 * account number has few enough values to try them all, so a scope stays
 * on the user's device, like the ledger it is part of, and never enters a
 * diagnostic, an export or the LLM payload (ADR 0011).
 */
export function accountScope(broker: string, accountId: string): AccountScope {
  return `${broker}:${digest([ACCOUNT_VERSION, broker, accountId])}` as AccountScope;
}

/**
 * The scope of an account a file does not name, such as Trading 212's: the
 * broker and the number of the group the user put the file in, from 1
 * (ADR 0011: one account unless the user says otherwise).
 */
export function accountGroup(broker: string, group: number): AccountScope {
  if (!Number.isSafeInteger(group) || group < 1) {
    throw new RangeError("An account group is a whole number from 1");
  }
  return `${broker}:${String(group)}` as AccountScope;
}
