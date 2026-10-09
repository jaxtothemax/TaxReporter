import { describe, expect, it } from "vitest";

import type { WizardAction } from "../state/wizard";
import type { Engine, PrepareArgs, ReadArgs } from "./client";
import { PROTOCOL_VERSION, type ReadReply } from "./protocol";
import { createRunner } from "./runner";

const readReply = (id: number): ReadReply => ({
  v: PROTOCOL_VERSION,
  id,
  kind: "read",
  files: [],
  findings: [],
  omittedFindings: 0,
  payers: [],
  symbols: {},
});

/** Bytes that arrive when the test says so, for every request waiting. */
function slowBytes() {
  const pending = new Map<string, (() => void)[]>();
  return {
    bytesOf: (id: string) =>
      new Promise<ArrayBuffer>((resolve) => {
        pending.set(id, [
          ...(pending.get(id) ?? []),
          () => {
            resolve(new ArrayBuffer(1));
          },
        ]);
      }),
    arrive: (id: string) => {
      for (const resolve of pending.get(id) ?? []) resolve();
      pending.delete(id);
    },
  };
}

/** An engine that records what reached it. */
function recordingEngine() {
  const reads: ReadArgs[] = [];
  const prepares: PrepareArgs[] = [];
  const engine: Engine = {
    read: (args) => {
      reads.push(args);
      return Promise.resolve(readReply(reads.length));
    },
    prepare: (args) => {
      prepares.push(args);
      return Promise.resolve({ v: PROTOCOL_VERSION, id: 0, kind: "failed" });
    },
  };
  return { engine, reads, prepares };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createRunner", () => {
  it("sends a request with its files, named, and answers it as an action", async () => {
    const { engine, reads } = recordingEngine();
    const actions: WizardAction[] = [];
    const runner = createRunner({
      engine,
      bytesOf: () => Promise.resolve(new ArrayBuffer(3)),
      labelOf: (id) => `${id}.csv`,
      dispatch: (action) => actions.push(action),
    });
    runner.read(["a", "b"], "same", 2026);
    await settled();
    expect(reads).toHaveLength(1);
    expect(reads[0]?.files.map((f) => [f.name, f.bytes.byteLength])).toEqual([
      ["a.csv", 3],
      ["b.csv", 3],
    ]);
    expect(actions).toEqual([
      { type: "readStarted", request: 1, fileIds: ["a", "b"] },
      { type: "readDone", request: 1, reply: readReply(1) },
    ]);
  });

  it("never sends a request a newer one started while its bytes were slow", async () => {
    const { engine, reads } = recordingEngine();
    const bytes = slowBytes();
    const actions: WizardAction[] = [];
    const runner = createRunner({
      engine,
      bytesOf: bytes.bytesOf,
      labelOf: (id) => id,
      dispatch: (action) => actions.push(action),
    });
    // A slow file is added, then removed: the second read starts at once.
    runner.read(["slow", "fast"], "same", 2026);
    runner.read(["fast"], "same", 2026);
    bytes.arrive("fast");
    await settled();
    expect(reads.map((r) => r.files.map((f) => f.name))).toEqual([["fast"]]);
    // The slow bytes arrive late: the stale request is dropped, unsent.
    bytes.arrive("slow");
    await settled();
    expect(reads).toHaveLength(1);
    expect(actions.filter((a) => a.type === "readDone")).toEqual([
      { type: "readDone", request: 2, reply: readReply(1) },
    ]);
  });

  it("answers a failure when the bytes cannot be read", async () => {
    const { engine, reads } = recordingEngine();
    const actions: WizardAction[] = [];
    const runner = createRunner({
      engine,
      bytesOf: () => Promise.reject(new Error("NotReadableError")),
      labelOf: (id) => id,
      dispatch: (action) => actions.push(action),
    });
    runner.read(["a"], "same", 2026);
    await settled();
    expect(reads).toEqual([]);
    expect(actions.at(-1)).toEqual({
      type: "readDone",
      request: 1,
      reply: { v: PROTOCOL_VERSION, id: 0, kind: "failed" },
    });
  });

  it("prepares with the details and payers it is given", async () => {
    const { engine, prepares } = recordingEngine();
    const actions: WizardAction[] = [];
    const runner = createRunner({
      engine,
      bytesOf: () => Promise.resolve(new ArrayBuffer(1)),
      labelOf: (id) => id,
      dispatch: (action) => actions.push(action),
    });
    const taxpayer = {
      taxNumber: "12345678",
      name: "",
      address: "",
      postCode: "",
      city: "",
      email: "",
    };
    runner.prepare(["a"], "separate", 2026, taxpayer, []);
    await settled();
    expect(prepares).toEqual([
      {
        files: [{ name: "a", bytes: new ArrayBuffer(1) }],
        accounts: "separate",
        taxYear: 2026,
        taxpayer,
        payers: [],
      },
    ]);
    expect(actions.map((a) => a.type)).toEqual([
      "prepareStarted",
      "prepareDone",
    ]);
  });
});
