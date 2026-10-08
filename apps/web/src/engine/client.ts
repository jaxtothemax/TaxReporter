/**
 * The page's side of the engine (ADR 0013): it starts the worker when first
 * asked, posts requests, and settles each with the worker's reply, checked
 * against the protocol. A reply that is not one is dropped; a worker that
 * fails, or takes longer than any real session could, is ended and every
 * request waiting on it settles as failed.
 */
import type { AccountChoice } from "@taxreporter/pipeline";

import {
  isReply,
  PROTOCOL_VERSION,
  type EngineReply,
  type FailedReply,
  type PayerDetails,
  type PrepareReply,
  type ReadReply,
  type RequestFile,
  type TaxpayerDetails,
} from "./protocol";

export interface ReadArgs {
  readonly files: readonly RequestFile[];
  readonly accounts: AccountChoice;
  readonly taxYear: number;
}

export interface PrepareArgs extends ReadArgs {
  readonly taxpayer: TaxpayerDetails;
  readonly payers: readonly PayerDetails[];
}

/** What the screens need of the engine; tests pass a fake. */
export interface Engine {
  read(args: ReadArgs): Promise<ReadReply | FailedReply>;
  prepare(args: PrepareArgs): Promise<PrepareReply | FailedReply>;
}

/** Far longer than reading 100 files of 64 MiB takes; then it has hung. */
const TIMEOUT_MS = 5 * 60 * 1000;

export function createWorkerEngine(
  start: () => Worker = () =>
    new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
    }),
): Engine {
  let worker: Worker | null = null;
  let nextId = 1;
  const waiting = new Map<number, (reply: EngineReply) => void>();

  function stop(): void {
    worker?.terminate();
    worker = null;
    const settle = [...waiting.entries()];
    waiting.clear();
    for (const [id, done] of settle) {
      done({ v: PROTOCOL_VERSION, id, kind: "failed" });
    }
  }

  function running(): Worker {
    if (worker !== null) return worker;
    const started = start();
    started.onmessage = (event: MessageEvent<unknown>) => {
      const reply = event.data;
      if (!isReply(reply)) return;
      const done = waiting.get(reply.id);
      if (done === undefined) return;
      waiting.delete(reply.id);
      done(reply);
    };
    started.onerror = stop;
    started.onmessageerror = stop;
    worker = started;
    return started;
  }

  function send(
    request:
      | (ReadArgs & { readonly kind: "read" })
      | (PrepareArgs & { readonly kind: "prepare" }),
  ): Promise<EngineReply> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve) => {
      const timer = setTimeout(stop, TIMEOUT_MS);
      waiting.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      // The bytes are copied, not transferred: the page keeps its files.
      running().postMessage({ ...request, v: PROTOCOL_VERSION, id });
    });
  }

  return {
    read: async (args) => {
      const reply = await send({ ...args, kind: "read" });
      return reply.kind === "prepare" ? failed(reply.id) : reply;
    },
    prepare: async (args) => {
      const reply = await send({ ...args, kind: "prepare" });
      return reply.kind === "read" ? failed(reply.id) : reply;
    },
  };
}

const failed = (id: number): FailedReply => ({
  v: PROTOCOL_VERSION,
  id,
  kind: "failed",
});
