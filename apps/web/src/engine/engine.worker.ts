/**
 * The engine worker (ADR 0013 §2–3). Its first import locks away the
 * network and storage APIs before any other module runs; then it answers
 * the page's requests with `handleRequest`, one at a time, in order.
 *
 * A message that is not a request of this protocol gets no work done: a
 * failure, if it names a request number the page could be waiting on,
 * otherwise nothing. Typed by hand rather than through the WebWorker
 * library, whose globals clash with the DOM's in one TypeScript project.
 */
import "./lockdown-now";

import type { RateTable } from "@taxreporter/fx";

import { handleRequest } from "./handle";
import { isRequest, PROTOCOL_VERSION, type FailedReply } from "./protocol";
import { loadRates } from "./rates";

interface WorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

let rates: Promise<RateTable> | null = null;

/** The snapshot, loaded once; a failed load is tried again next time. */
function snapshot(): Promise<RateTable> {
  rates ??= loadRates().catch((error: unknown) => {
    rates = null;
    throw error;
  });
  return rates;
}

/** The request number a message names, if it names one at all. */
function requestId(message: unknown): number | null {
  if (typeof message !== "object" || message === null) return null;
  const id: unknown = (message as { readonly id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0
    ? id
    : null;
}

/** Tells the page a request failed; if even that cannot be sent, its timeout ends the wait. */
function fail(id: number): void {
  const reply: FailedReply = { v: PROTOCOL_VERSION, id, kind: "failed" };
  try {
    scope.postMessage(reply);
  } catch {
    // Nothing more can reach the page.
  }
}

/** Requests are answered in the order they came, never two at once. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  if (!isRequest(request)) {
    const id = requestId(request);
    if (id !== null) fail(id);
    return;
  }
  // A step that throws, even in posting its reply, answers as a failure
  // and leaves the queue running for the next request.
  queue = queue
    .then(async () => {
      scope.postMessage(await handleRequest(request, snapshot));
    })
    .catch(() => {
      fail(request.id);
    });
};
