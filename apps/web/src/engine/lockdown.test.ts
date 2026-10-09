import { describe, expect, it, vi } from "vitest";

import { LOCKED, lockDown } from "./lockdown";

/**
 * A stand-in for a worker's global scope as Chromium lays it out: the
 * scope, then WorkerGlobalScope.prototype with the APIs on it, then an
 * EventTarget.prototype with one more, then Object.prototype.
 */
function workerScope(): {
  readonly scope: object;
  readonly levels: readonly object[];
} {
  const eventTarget: Record<string, unknown> = Object.create(
    Object.prototype,
  ) as Record<string, unknown>;
  Object.defineProperty(eventTarget, "fetch", {
    value: () => "reached from further up",
    writable: true,
    configurable: true,
  });
  const workerGlobal = Object.create(eventTarget) as Record<string, unknown>;
  for (const name of LOCKED) {
    Object.defineProperty(workerGlobal, name, {
      get: () => () => "reached",
      configurable: true,
    });
  }
  const scope = Object.create(workerGlobal) as object;
  return { scope, levels: [scope, workerGlobal, eventTarget] };
}

describe("lockDown", () => {
  it("leaves no way to the network or to storage", () => {
    const { scope } = workerScope();
    lockDown(scope);
    for (const name of LOCKED) {
      expect(Reflect.get(scope, name), name).toBeUndefined();
    }
  });

  it("takes each name from the prototypes too, where calling it would still work", () => {
    const { scope, levels } = workerScope();
    lockDown(scope);
    for (const level of levels) {
      for (const name of LOCKED) {
        const descriptor = Object.getOwnPropertyDescriptor(level, name);
        if (descriptor === undefined) continue;
        // A getter would still answer: none may be left, nor any value.
        expect(Object.keys(descriptor).sort(), name).toEqual([
          "configurable",
          "enumerable",
          "value",
          "writable",
        ]);
        expect(descriptor.value, name).toBeUndefined();
      }
    }
    // As a page script would try it: WorkerGlobalScope.prototype.fetch.call.
    expect(Reflect.get(levels[1] ?? {}, "fetch")).toBeUndefined();
    expect(Reflect.get(levels[2] ?? {}, "fetch")).toBeUndefined();
    // Nothing is added to Object.prototype, which never had the names.
    expect(Object.hasOwn(Object.prototype, "fetch")).toBe(false);
  });

  it("cannot be undone", () => {
    const scope = workerScope().scope as Record<string, unknown>;
    lockDown(scope);
    expect(() => {
      scope["fetch"] = () => "again";
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(scope, "fetch", { value: () => "again" }),
    ).toThrow(TypeError);
  });

  it("refuses to start half locked", () => {
    const { scope } = workerScope();
    Object.defineProperty(scope, "fetch", {
      value: () => "pinned",
      configurable: false,
    });
    expect(() => {
      lockDown(scope);
    }).toThrow();
  });

  it("refuses to start when a name still answers after it was shadowed", () => {
    // A global object that takes the definitions without applying them:
    // only the check that follows them can tell.
    const { scope } = workerScope();
    vi.spyOn(Object, "defineProperty").mockImplementation((target) => target);
    expect(() => {
      lockDown(scope);
    }).toThrow("The engine could not lock down");
  });

  it("names the network, storage and other contexts", () => {
    expect(LOCKED).toEqual(
      expect.arrayContaining([
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "importScripts",
        "indexedDB",
        "caches",
        "navigator",
        "Worker",
        "FontFace",
        "WebSocketStream",
        "webkitRequestFileSystem",
      ]),
    );
  });
});
