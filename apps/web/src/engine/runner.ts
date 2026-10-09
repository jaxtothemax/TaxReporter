/**
 * Reads and preparations, from the page to the engine and back (ADR 0013
 * §5), as a plain function the app's effects call, so the order of events
 * is testable without a DOM.
 *
 * Every request is numbered, and only the latest is sent. A request waits
 * for its files' bytes first; if a newer one started meanwhile (the user
 * removed a file whose bytes were slow to arrive), the older is dropped
 * before it reaches the engine, where it would end the newer one's work.
 * Whatever is answered goes back as an action; the reducer drops an answer
 * to any but the latest request as well.
 */
import type { AccountChoice } from "@taxreporter/pipeline";

import type { WizardAction } from "../state/wizard";
import type { Engine } from "./client";
import {
  PROTOCOL_VERSION,
  type FailedReply,
  type PayerDetails,
  type RequestFile,
  type TaxpayerDetails,
} from "./protocol";

/** What a request that never reached the engine settles as. */
const FAILED: FailedReply = { v: PROTOCOL_VERSION, id: 0, kind: "failed" };

export interface RunnerDeps {
  readonly engine: Engine;
  /** The bytes of a listed file, read once when first asked for. */
  readonly bytesOf: (id: string) => Promise<ArrayBuffer>;
  /** The name a file is known by in the session. */
  readonly labelOf: (id: string) => string;
  readonly dispatch: (action: WizardAction) => void;
}

export interface Runner {
  read(
    fileIds: readonly string[],
    accounts: AccountChoice,
    taxYear: number,
  ): void;
  prepare(
    fileIds: readonly string[],
    accounts: AccountChoice,
    taxYear: number,
    taxpayer: TaxpayerDetails,
    payers: readonly PayerDetails[],
  ): void;
}

export function createRunner(deps: RunnerDeps): Runner {
  let next = 1;
  let latest = 0;

  async function filesOf(fileIds: readonly string[]): Promise<RequestFile[]> {
    return Promise.all(
      fileIds.map(async (id) => ({
        name: deps.labelOf(id),
        bytes: await deps.bytesOf(id),
      })),
    );
  }

  /** Numbers a request, waits for its bytes, sends it only if still latest. */
  function run<R>(
    fileIds: readonly string[],
    started: (request: number) => WizardAction,
    send: (files: RequestFile[]) => Promise<R>,
    done: (request: number, reply: R | FailedReply) => WizardAction,
  ): void {
    const request = next;
    next += 1;
    latest = request;
    deps.dispatch(started(request));
    void filesOf(fileIds)
      .then((files) => (latest === request ? send(files) : null))
      .catch(() => FAILED)
      .then((reply) => {
        if (reply !== null) deps.dispatch(done(request, reply));
      });
  }

  return {
    read(fileIds, accounts, taxYear) {
      run(
        fileIds,
        (request) => ({ type: "readStarted", request, fileIds }),
        (files) => deps.engine.read({ files, accounts, taxYear }),
        (request, reply) => ({ type: "readDone", request, reply }),
      );
    },
    prepare(fileIds, accounts, taxYear, taxpayer, payers) {
      run(
        fileIds,
        (request) => ({ type: "prepareStarted", request, fileIds }),
        (files) =>
          deps.engine.prepare({ files, accounts, taxYear, taxpayer, payers }),
        (request, reply) => ({ type: "prepareDone", request, reply }),
      );
    },
  };
}
