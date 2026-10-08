import { describe, expect, it, vi } from "vitest";

import { LOCKED, lockDown } from "./lockdown";

/** A stand-in for a worker's global scope, its APIs on the prototype. */
function workerScope(): object {
  const proto: Record<string, unknown> = {};
  for (const name of LOCKED) {
    Object.defineProperty(proto, name, {
      get: () => () => "reached",
      configurable: true,
    });
  }
  return Object.create(proto) as object;
}

describe("lockDown", () => {
  it("leaves no way to the network or to storage", () => {
    const scope = workerScope();
    lockDown(scope);
    for (const name of LOCKED) {
      expect((scope as Record<string, unknown>)[name], name).toBeUndefined();
    }
  });

  it("cannot be undone", () => {
    const scope = workerScope() as Record<string, unknown>;
    lockDown(scope);
    expect(() => {
      scope["fetch"] = () => "again";
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(scope, "fetch", { value: () => "again" }),
    ).toThrow(TypeError);
  });

  it("refuses to start half locked", () => {
    const scope = workerScope();
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
    const scope = workerScope();
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
      ]),
    );
  });
});
