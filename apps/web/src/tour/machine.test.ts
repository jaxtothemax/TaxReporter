import { describe, expect, it } from "vitest";

import {
  atEnd,
  atStart,
  createTourReducer,
  initialTourState,
  inView,
  type TourAction,
  type TourState,
} from "./machine";

// Three stops: two notes, three notes, one note.
const COUNTS = [2, 3, 1] as const;
const reduce = createTourReducer(COUNTS);

const run = (...actions: readonly TourAction[]): TourState =>
  actions.reduce(reduce, initialTourState);

const walk = (capacity: number): readonly string[] => {
  const seen: string[] = [];
  let state = run({ type: "start" });
  for (let i = 0; i < 20 && state.run !== null; i += 1) {
    const { from, to } = inView(
      state.run,
      COUNTS[state.run.stop] ?? 0,
      capacity,
    );
    seen.push(`${String(state.run.stop)}:${String(from)}-${String(to)}`);
    const next = reduce(state, { type: "next", capacity });
    if (next === state) break;
    state = next;
  }
  return seen;
};

describe("starting the tour", () => {
  it("starts at the first stop the first time, and never again on its own", () => {
    const started = run({ type: "start" });
    expect(started).toEqual({ seen: true, run: { stop: 0, note: 0 } });
    const skipped = reduce(started, { type: "exit" });
    expect(skipped).toEqual({ seen: true, run: null });
    expect(reduce(skipped, { type: "start" })).toBe(skipped);
  });

  it("starts again from the first stop when asked to", () => {
    const later = run(
      { type: "start" },
      { type: "next", capacity: 3 },
      { type: "exit" },
      { type: "replay" },
    );
    expect(later.run).toEqual({ stop: 0, note: 0 });
  });

  it("changes nothing when not running", () => {
    for (const action of [
      { type: "exit" },
      { type: "next", capacity: 3 },
      { type: "back", capacity: 1 },
    ] as const) {
      expect(reduce(initialTourState, action)).toBe(initialTourState);
    }
  });

  it("refuses a script it could not show", () => {
    expect(() => createTourReducer([])).toThrow();
    expect(() => createTourReducer([2, 0])).toThrow();
  });
});

describe("moving through the stops", () => {
  it("shows a stop's notes together where they fit", () => {
    expect(walk(3)).toEqual(["0:0-2", "1:0-3", "2:0-1"]);
  });

  it("shows them one at a time where they do not", () => {
    expect(walk(1)).toEqual([
      "0:0-1",
      "0:1-2",
      "1:0-1",
      "1:1-2",
      "1:2-3",
      "2:0-1",
    ]);
  });

  it("goes back the way it came", () => {
    for (const capacity of [1, 2, 3]) {
      const forward = walk(capacity);
      let state = run({ type: "start" });
      while (!atEnd(state.run ?? { stop: 0, note: 0 }, COUNTS, capacity)) {
        state = reduce(state, { type: "next", capacity });
      }
      const backward: string[] = [];
      for (let i = 0; i < 20 && state.run !== null; i += 1) {
        const { from, to } = inView(
          state.run,
          COUNTS[state.run.stop] ?? 0,
          capacity,
        );
        backward.push(
          `${String(state.run.stop)}:${String(from)}-${String(to)}`,
        );
        if (atStart(state.run, capacity)) break;
        state = reduce(state, { type: "back", capacity });
      }
      expect(backward).toEqual([...forward].reverse());
    }
  });

  it("stays put at either end: leaving is always exit", () => {
    const first = run({ type: "start" });
    expect(reduce(first, { type: "back", capacity: 3 })).toBe(first);
    const last = run(
      { type: "start" },
      { type: "next", capacity: 3 },
      { type: "next", capacity: 3 },
    );
    expect(last.run).toEqual({ stop: 2, note: 0 });
    expect(reduce(last, { type: "next", capacity: 3 })).toBe(last);
  });

  it("keeps the note in view when the screen changes size mid-stop", () => {
    // On a phone, at the third note of the second stop...
    const phone = run(
      { type: "start" },
      { type: "next", capacity: 1 },
      { type: "next", capacity: 1 },
      { type: "next", capacity: 1 },
      { type: "next", capacity: 1 },
    );
    expect(phone.run).toEqual({ stop: 1, note: 2 });
    // ...then wide: the whole stop shows, and Next moves to the next stop.
    expect(inView(phone.run ?? { stop: 0, note: 0 }, 3, 3)).toEqual({
      from: 0,
      to: 3,
    });
    expect(reduce(phone, { type: "next", capacity: 3 }).run).toEqual({
      stop: 2,
      note: 0,
    });
    // Back from there, wide, goes to the previous stop, not to a lost note.
    expect(reduce(phone, { type: "back", capacity: 3 }).run).toEqual({
      stop: 0,
      note: 0,
    });
  });

  it("never shows past a stop's last note", () => {
    expect(inView({ stop: 0, note: 5 }, 2, 1)).toEqual({ from: 1, to: 2 });
    expect(inView({ stop: 0, note: 0 }, 2, 0)).toEqual({ from: 0, to: 1 });
  });
});
