/**
 * The engine worker (ADR 0013 §2–3): it locks away the network and storage,
 * then answers the page's requests with `handleRequest`, one at a time. A
 * message that is not a request of this protocol's version is ignored.
 *
 * Typed by hand rather than through the WebWorker library, whose globals
 * clash with the DOM's in one TypeScript project.
 */
import type { RateTable } from "@taxreporter/fx";

import { handleRequest } from "./handle";
import { lockDown } from "./lockdown";
import { isRequest } from "./protocol";
import { loadRates } from "./rates";

interface WorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

lockDown(globalThis);

let rates: Promise<RateTable> | null = null;

/** The snapshot, loaded once; a failed load is tried again next time. */
function snapshot(): Promise<RateTable> {
  rates ??= loadRates().catch((error: unknown) => {
    rates = null;
    throw error;
  });
  return rates;
}

/** Requests are answered in the order they came, never two at once. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  if (!isRequest(request)) return;
  queue = queue.then(async () => {
    scope.postMessage(await handleRequest(request, snapshot));
  });
};
