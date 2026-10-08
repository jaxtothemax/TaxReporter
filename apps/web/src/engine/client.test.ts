import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkerEngine } from "./client";
import { PROTOCOL_VERSION } from "./protocol";

/** A worker that keeps what it is sent and replies when told to. */
class FakeWorker {
  readonly sent: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

const args = { files: [], accounts: "same", taxYear: 2026 } as const;
const readReply = (id: number) => ({
  v: PROTOCOL_VERSION,
  id,
  kind: "read",
  files: [],
  findings: [],
  payers: [],
  symbols: {},
});

function engineWithFake() {
  const workers: FakeWorker[] = [];
  const engine = createWorkerEngine(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { engine, workers };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createWorkerEngine", () => {
  it("starts one worker when first asked, and numbers each request", async () => {
    const { engine, workers } = engineWithFake();
    expect(workers).toHaveLength(0);
    const first = engine.read(args);
    const second = engine.read(args);
    expect(workers).toHaveLength(1);
    const worker = workers[0] as FakeWorker;
    expect(worker.sent).toMatchObject([
      { v: PROTOCOL_VERSION, id: 1, kind: "read" },
      { v: PROTOCOL_VERSION, id: 2, kind: "read" },
    ]);
    worker.reply(readReply(2));
    worker.reply(readReply(1));
    expect((await first).id).toBe(1);
    expect((await second).id).toBe(2);
  });

  it("drops a reply that is not one, and settles on the real one", async () => {
    const { engine, workers } = engineWithFake();
    const pending = engine.read(args);
    const worker = workers[0] as FakeWorker;
    worker.reply({ ...readReply(1), v: 99 });
    worker.reply({ ...readReply(1), findings: [{ code: "nope" }] });
    worker.reply("<script>");
    worker.reply(readReply(1));
    // Settled by the one reply that is one, not by the first to arrive.
    expect(await pending).toEqual(readReply(1));
  });

  it("settles every waiting request as failed when the worker fails", async () => {
    const { engine, workers } = engineWithFake();
    const one = engine.read(args);
    const two = engine.read(args);
    const worker = workers[0] as FakeWorker;
    worker.onerror?.();
    expect([(await one).kind, (await two).kind]).toEqual(["failed", "failed"]);
    expect(worker.terminated).toBe(true);
    // The next request starts a new worker.
    void engine.read(args);
    expect(workers).toHaveLength(2);
  });

  it("gives up on a worker that hangs", async () => {
    vi.useFakeTimers();
    const { engine, workers } = engineWithFake();
    const pending = engine.read(args);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect((await pending).kind).toBe("failed");
    expect(workers[0]?.terminated).toBe(true);
  });

  it("does not take a read's reply for a prepare", async () => {
    const { engine, workers } = engineWithFake();
    const pending = engine.prepare({
      ...args,
      taxpayer: {
        taxNumber: "12345678",
        name: "",
        address: "",
        postCode: "",
        city: "",
        email: "",
      },
      payers: [],
    });
    workers[0]?.reply(readReply(1));
    expect((await pending).kind).toBe("failed");
  });
});
