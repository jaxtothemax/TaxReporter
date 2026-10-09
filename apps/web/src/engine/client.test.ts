import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bootstrapSource,
  createWorkerEngine,
  startEngineWorker,
} from "./client";
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
  omittedFindings: 0,
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
  it("starts a worker when first asked, and numbers each request", async () => {
    const { engine, workers } = engineWithFake();
    expect(workers).toHaveLength(0);
    const first = engine.read(args);
    expect(workers).toHaveLength(1);
    workers[0]?.reply(readReply(1));
    expect(await first).toEqual(readReply(1));
    const second = engine.read(args);
    // The same worker, idle again, takes the next request.
    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent).toMatchObject([
      { v: PROTOCOL_VERSION, id: 1, kind: "read" },
      { v: PROTOCOL_VERSION, id: 2, kind: "read" },
    ]);
    workers[0]?.reply(readReply(2));
    expect((await second).id).toBe(2);
  });

  it("ends a worker still busy with a request a newer one makes stale", async () => {
    const { engine, workers } = engineWithFake();
    const stale = engine.read(args);
    const fresh = engine.read(args);
    // The first worker, and the copy of the files it holds, are gone.
    expect((await stale).kind).toBe("failed");
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent).toMatchObject([{ id: 2, kind: "read" }]);
    // An ended worker's late error does not end the one that replaced it.
    workers[0]?.onerror?.();
    workers[1]?.reply(readReply(2));
    expect((await fresh).id).toBe(2);
    expect(workers[1]?.terminated).toBe(false);
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

  it("settles the waiting request as failed when the worker fails", async () => {
    const { engine, workers } = engineWithFake();
    const one = engine.read(args);
    const worker = workers[0] as FakeWorker;
    worker.onerror?.();
    expect((await one).kind).toBe("failed");
    expect(worker.terminated).toBe(true);
    // The next request starts a new worker.
    void engine.read(args);
    expect(workers).toHaveLength(2);
  });

  it("fails a request it could not send, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    let refuse = true;
    const engine = createWorkerEngine(() => {
      const worker = new FakeWorker();
      worker.postMessage = (message: unknown) => {
        if (refuse) throw new Error("DataCloneError");
        worker.sent.push(message);
      };
      workers.push(worker);
      return worker as unknown as Worker;
    });
    expect((await engine.read(args)).kind).toBe("failed");
    // Three minutes on, a second request: a timer the first had left
    // behind would end its worker two minutes into it.
    vi.advanceTimersByTime(3 * 60 * 1000);
    refuse = false;
    const next = engine.read(args);
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(workers[0]?.terminated).toBe(false);
    workers[0]?.reply(readReply(2));
    expect((await next).id).toBe(2);
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

describe("startEngineWorker", () => {
  it("starts the engine from a blob: bootstrap, so the page's policy applies", async () => {
    const started: { url: string; options: unknown }[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        readonly url: string;
        constructor(url: string, options: unknown) {
          this.url = url;
          started.push({ url, options });
        }
      },
    );
    const blobs: Blob[] = [];
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return "blob:https://app.example/1";
      });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    startEngineWorker(
      "/app/assets/engine.worker-abc.js",
      "https://app.example/app/",
    );
    expect(started).toEqual([
      { url: "blob:https://app.example/1", options: { type: "module" } },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await blobs[0]?.text()).toBe(
      'import "https://app.example/app/assets/engine.worker-abc.js";\n',
    );
    // Revoked once the worker has it: no blob: URL is left behind.
    expect(revoke).toHaveBeenCalledWith("blob:https://app.example/1");
  });

  it("writes the engine's address as a string, never as code", () => {
    expect(bootstrapSource('x";alert(1);"')).toBe(
      'import "x\\";alert(1);\\"";\n',
    );
  });
});
