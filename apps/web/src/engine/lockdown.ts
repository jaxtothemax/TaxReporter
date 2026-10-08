/**
 * What the engine worker removes from its own global scope before it reads
 * a file (ADR 0013 §3): every way to reach the network or to store data. The
 * page's Content Security Policy already forbids other origins; this makes
 * "parsers do not touch the network" hold for the same origin too, and makes
 * keeping a file impossible rather than merely absent.
 *
 * The module loader is not among them: the rate snapshot arrives as bundled
 * modules, which `import()` loads under the policy's script rules.
 */
export const LOCKED = [
  // The network.
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "importScripts",
  // Storage, and through navigator.storage the origin's private file system.
  "indexedDB",
  "caches",
  "navigator",
  // Other contexts, each with a network of its own.
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
] as const;

/**
 * Shadows each name with an undefined, read-only, non-configurable own
 * property, then checks that none is left. It throws rather than run half
 * locked: a worker that failed to start reads nothing.
 */
export function lockDown(scope: object): void {
  for (const name of LOCKED) {
    Object.defineProperty(scope, name, {
      value: undefined,
      writable: false,
      configurable: false,
    });
  }
  const open = LOCKED.filter(
    (name) => (scope as Record<string, unknown>)[name] !== undefined,
  );
  if (open.length > 0) throw new Error("The engine could not lock down");
}
