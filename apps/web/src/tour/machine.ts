/**
 * Where the guided tour stands, as a pure reducer (ADR 0016). It is held next
 * to the wizard, not in it: starting over resets the wizard but never re-arms
 * the tour, so a tour skipped once does not start again on its own for the
 * rest of the page session. Nothing here is stored (ADR 0002): a new page
 * session starts unseen.
 *
 * A stop shows up to `capacity` of its notes at once: three on a wide screen,
 * one at a time on a phone or where the notes do not fit beside the card. The
 * position is kept as the first note in view, not as a page number, so a
 * change of capacity in the middle of a stop keeps the note the user was on.
 */

export interface TourRun {
  /** The stop shown, by its position in the script. */
  readonly stop: number;
  /** The first of the stop's notes in view. */
  readonly note: number;
}

export interface TourState {
  /** Whether the tour has started in this page session. */
  readonly seen: boolean;
  /** The stop and notes in view, or null while the tour is not running. */
  readonly run: TourRun | null;
}

export type TourAction =
  /** Entering the demo: starts the tour only the first time. */
  | { readonly type: "start" }
  /** The tour button: starts it again from the first stop. */
  | { readonly type: "replay" }
  | { readonly type: "next"; readonly capacity: number }
  | { readonly type: "back"; readonly capacity: number }
  /** Skip, Escape or Finish: every way out of the tour is this one. */
  | { readonly type: "exit" };

export const initialTourState: TourState = Object.freeze({
  seen: false,
  run: null,
});

const FIRST: TourRun = Object.freeze({ stop: 0, note: 0 });

/** The first note of the group that `note` falls in, `capacity` notes a group. */
export function groupStart(note: number, capacity: number): number {
  const size = Math.max(1, Math.floor(capacity));
  return Math.floor(note / size) * size;
}

/** The notes in view: a half-open range into the stop's notes. */
export function inView(
  run: TourRun,
  count: number,
  capacity: number,
): { readonly from: number; readonly to: number } {
  const from = Math.min(
    groupStart(run.note, capacity),
    lastGroup(count, capacity),
  );
  return {
    from,
    to: Math.min(count, from + Math.max(1, Math.floor(capacity))),
  };
}

function lastGroup(count: number, capacity: number): number {
  return groupStart(Math.max(0, count - 1), capacity);
}

/** Whether `run` shows the last notes of the last stop. */
export function atEnd(
  run: TourRun,
  noteCounts: readonly number[],
  capacity: number,
): boolean {
  const count = noteCounts[run.stop] ?? 0;
  return (
    run.stop >= noteCounts.length - 1 &&
    inView(run, count, capacity).to >= count
  );
}

/** Whether `run` shows the first notes of the first stop. */
export function atStart(run: TourRun, capacity: number): boolean {
  return run.stop === 0 && groupStart(run.note, capacity) === 0;
}

/**
 * The reducer for a script whose stops hold `noteCounts[i]` notes each. Next
 * at the end and Back at the start change nothing: leaving is always `exit`.
 */
export function createTourReducer(
  noteCounts: readonly number[],
): (state: TourState, action: TourAction) => TourState {
  if (noteCounts.length === 0 || noteCounts.some((n) => n < 1)) {
    throw new Error("A tour needs at least one stop, each with a note");
  }
  return (state, action) => {
    switch (action.type) {
      case "start":
        return state.seen ? state : { seen: true, run: FIRST };
      case "replay":
        return { seen: true, run: FIRST };
      case "exit":
        return state.run === null ? state : { ...state, run: null };
      case "next": {
        const { run } = state;
        if (run === null || atEnd(run, noteCounts, action.capacity)) {
          return state;
        }
        const count = noteCounts[run.stop] ?? 0;
        const { to } = inView(run, count, action.capacity);
        return {
          ...state,
          run:
            to < count
              ? { stop: run.stop, note: to }
              : { stop: run.stop + 1, note: 0 },
        };
      }
      case "back": {
        const { run } = state;
        if (run === null || atStart(run, action.capacity)) return state;
        const count = noteCounts[run.stop] ?? 0;
        const { from } = inView(run, count, action.capacity);
        if (from > 0) {
          return {
            ...state,
            run: {
              stop: run.stop,
              note: groupStart(from - 1, action.capacity),
            },
          };
        }
        const previous = run.stop - 1;
        return {
          ...state,
          run: {
            stop: previous,
            note: lastGroup(noteCounts[previous] ?? 1, action.capacity),
          },
        };
      }
    }
  };
}
