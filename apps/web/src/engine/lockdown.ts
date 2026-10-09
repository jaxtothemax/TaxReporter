/**
 * What the engine worker removes from its own global scope before it reads
 * a file (ADR 0013 §3): the ways to reach the network or to store data that
 * a worker has. It is a second layer: the first is the page's Content
 * Security Policy, which the worker inherits through its blob: bootstrap
 * (client.ts) and which also closes what no list can name, such as eval and
 * import() of another origin.
 *
 * Browsers define most of these on the scope's prototypes
 * (WorkerGlobalScope.prototype, EventTarget.prototype), not on the scope:
 * a property on the scope alone would only hide them, and
 * `WorkerGlobalScope.prototype.fetch.call(self, url)` would still work. So
 * each name is replaced on the scope and on every object up its prototype
 * chain that has it, and every level is checked afterwards.
 */
export const LOCKED = [
  // The network.
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebSocketStream",
  "EventSource",
  "WebTransport",
  "importScripts",
  // Fonts load from a URL.
  "FontFace",
  "fonts",
  // Storage, and through navigator.storage the origin's private file system.
  "indexedDB",
  "caches",
  "navigator",
  "webkitRequestFileSystem",
  "webkitRequestFileSystemSync",
  "webkitResolveLocalFileSystemURL",
  "webkitResolveLocalFileSystemSyncURL",
  // Other contexts, each with a network of its own.
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
] as const;

/** The scope and every prototype above it, nearest first. */
function chain(scope: object): object[] {
  const levels: object[] = [];
  for (
    let level: object | null = scope;
    level !== null;
    level = Object.getPrototypeOf(level) as object | null
  ) {
    levels.push(level);
  }
  return levels;
}

const LOCKED_VALUE = {
  value: undefined,
  writable: false,
  configurable: false,
} as const;

/** Whether a level still holds a name with anything but undefined in it. */
function stillOpen(level: object, name: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(level, name);
  return (
    descriptor !== undefined &&
    (descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor.value !== undefined)
  );
}

/**
 * Replaces each name with an undefined, read-only, non-configurable
 * property on the scope and on every prototype that defines it, then checks
 * that no level holds one and that none resolves from the scope. It throws
 * rather than run half locked: a worker that failed to start reads nothing.
 */
export function lockDown(scope: object): void {
  const levels = chain(scope);
  for (const name of LOCKED) {
    for (const level of levels) {
      if (level === scope || Object.hasOwn(level, name)) {
        Object.defineProperty(level, name, LOCKED_VALUE);
      }
    }
  }
  const open = LOCKED.filter(
    (name) =>
      levels.some((level) => stillOpen(level, name)) ||
      Reflect.get(scope, name) !== undefined,
  );
  if (open.length > 0) throw new Error("The engine could not lock down");
}
