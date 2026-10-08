/**
 * The worker entry, run in Node: it locks down as it loads, answers only
 * requests of this protocol, one at a time and in order, and loads the rate
 * snapshot once, trying again after a failed load. The lockdown and the
 * handler are stand-ins here, so the test process keeps its own globals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineRequest } from "./protocol";

const lockDown = vi.fn();
vi.mock("./lockdown", () => ({ lockDown }));

const loadRates = vi.fn();
vi.mock("./rates", () => ({ loadRates }));

const handleRequest =
  vi.fn<
    (
      request: EngineRequest,
      rates: () => Promise<unknown>,
    ) => Promise<{ readonly id: number }>
  >();
vi.mock("./handle", () => ({ handleRequest }));

type Scope = { onmessage: ((event: { data: unknown }) => void) | null };

const request = (id: number): EngineRequest => ({
  v: 1,
  id,
  kind: "read",
  files: [],
  accounts: "same",
  taxYear: 2026,
});

/** Loads the worker afresh against a stubbed postMessage. */
async function start(): Promise<{
  readonly send: (data: unknown) => void;
  readonly posted: unknown[];
}> {
  const posted: unknown[] = [];
  vi.stubGlobal("postMessage", (message: unknown) => {
    posted.push(message);
  });
  vi.resetModules();
  await import("./engine.worker");
  const scope = globalThis as unknown as Scope;
  return {
    send: (data) => {
      scope.onmessage?.({ data });
    },
    posted,
  };
}

/** Lets every queued promise settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  lockDown.mockReset();
  loadRates.mockReset();
  handleRequest.mockReset();
  handleRequest.mockImplementation((r) => Promise.resolve({ id: r.id }));
});

describe("engine.worker", () => {
  it("locks its global scope down as it loads, before any message", async () => {
    const { posted } = await start();
    expect(lockDown).toHaveBeenCalledWith(globalThis);
    expect(posted).toEqual([]);
  });

  it("ignores anything that is not a request of this protocol", async () => {
    const { send, posted } = await start();
    send("hello");
    send({ ...request(1), v: 2 });
    send({ ...request(1), kind: "delete" });
    await settled();
    expect(handleRequest).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it("answers requests one at a time, in the order they came", async () => {
    let finishFirst = (): void => undefined;
    handleRequest.mockImplementationOnce(
      (r) =>
        new Promise((resolve) => {
          finishFirst = () => {
            resolve({ id: r.id });
          };
        }),
    );
    const { send, posted } = await start();
    send(request(1));
    send(request(2));
    await settled();
    // The second waits for the first, however quick it would be.
    expect(handleRequest).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([]);
    finishFirst();
    await settled();
    expect(posted).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("loads the rate snapshot once, and again after a failed load", async () => {
    handleRequest.mockImplementation(async (r, rates) => {
      await rates().catch(() => undefined);
      return { id: r.id };
    });
    loadRates
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("rates");
    const { send } = await start();
    for (const id of [1, 2, 3]) send(request(id));
    await settled();
    await settled();
    expect(loadRates).toHaveBeenCalledTimes(2);
  });
});
