/**
 * The page's side of the engine (ADR 0013): it starts the worker when first
 * asked, posts requests, and settles each with the worker's reply, checked
 * against the protocol. A reply that is not one is dropped; a worker that
 * fails, or takes longer than any real session could, is ended and every
 * request waiting on it settles as failed.
 *
 * One request at a time: a newer one makes any older one stale (the page
 * drops its answer anyway), so the worker still busy with it is ended, not
 * left to hold a second copy of every file while it finishes.
 */
import type { AccountChoice } from "@taxreporter/pipeline";

import engineUrl from "./engine.worker.ts?worker&url";
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

/** The whole of the bootstrap: one import of the bundled engine. */
export function bootstrapSource(engine: string): string {
  return `import ${JSON.stringify(engine)};\n`;
}

/**
 * The engine worker, started from a blob: bootstrap that imports the
 * bundled engine. A worker loaded from its own URL is governed by the
 * headers its script is served with, and the static host sends none, so it
 * would run under no Content Security Policy at all; a worker from a local
 * blob: URL inherits the page's policy instead (CSP Level 3, "policy
 * container" of a worker from a local scheme). Under it, eval and every
 * other origin stay closed to the engine, whatever the lockdown misses.
 */
export function startEngineWorker(
  engine: string = engineUrl,
  base: string = globalThis.location.href,
): Worker {
  const entry = new URL(engine, base).href;
  const bootstrap = new Blob([bootstrapSource(entry)], {
    type: "text/javascript",
  });
  const url = URL.createObjectURL(bootstrap);
  try {
    return new Worker(url, { type: "module" });
  } finally {
    // The worker resolved the URL when it was constructed.
    URL.revokeObjectURL(url);
  }
}

export function createWorkerEngine(
  start: () => Worker = startEngineWorker,
): Engine {
  let worker: Worker | null = null;
  let nextId = 1;
  const waiting = new Map<number, (reply: EngineReply) => void>();

  function stop(): void {
    if (worker !== null) {
      // An ended worker says nothing more, not even a late error.
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
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
    // Whatever is still being answered is stale now: end it.
    if (waiting.size > 0) stop();
    const id = nextId;
    nextId += 1;
    return new Promise((resolve) => {
      const timer = setTimeout(stop, TIMEOUT_MS);
      waiting.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      try {
        // The bytes are copied, not transferred: the page keeps its files.
        running().postMessage({ ...request, v: PROTOCOL_VERSION, id });
      } catch {
        // Not sent (the worker would not start, or the request would not
        // copy): it fails now, and leaves no timer to end a later worker.
        clearTimeout(timer);
        waiting.delete(id);
        resolve(failed(id));
      }
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
