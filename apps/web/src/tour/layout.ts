/**
 * Where a tour stop's explanations go, as pure geometry over measured
 * rectangles (ADR 0016). The component measures; these functions decide.
 *
 * Three presentations, tried in the stop's order of preference:
 * - "gutter": boxes beside the focus card, in the space between it and the
 *   window's edge, joined to their targets by horizontal lines;
 * - "row": boxes above and below the card, joined by vertical lines;
 * - "sheet": one explanation at a time inside the dock at the bottom, with a
 *   ring on its target and no line. Always on a phone, and wherever the
 *   others do not fit.
 *
 * Whether a presentation fits depends only on sizes (the window, the dock,
 * the card and every box of the stop), never on the scroll position, so it
 * cannot flip back and forth while the user scrolls. Placement then follows
 * the card wherever it is. A box never covers the card: boxes sit outside it,
 * and a line enters the card only to end in a ring at its target's edge.
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The window the dialog covers, and the bands nothing may cross. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  /** The bottom of the app header: the focus card stays below it. */
  readonly headerBottom: number;
  /** The top of the dock: nothing is placed below it. */
  readonly dockTop: number;
}

export type Side = "left" | "right" | "above" | "below";
export type Point = readonly [number, number];

export interface Placed {
  readonly box: Box;
  readonly side: Side;
  /** From the box to the ring; null where the target is not in view. */
  readonly line: readonly Point[] | null;
  readonly ring: Point | null;
}

/** At this width and below (the phone breakpoint), one at a time. */
export const WIDE = 720;

export const SPACE = {
  /** Between the card and a gutter box. */
  gutter: 40,
  /** Between the card and a row of boxes. */
  row: 32,
  /** Between stacked gutter boxes. */
  stack: 12,
  /** Between boxes side by side in a row. */
  beside: 16,
  /** Kept free at the window's edges. */
  edge: 16,
  /** From a target's edge to its ring's center. */
  ring: 9,
  /** A line leaves a box at least this far from its corners. */
  inset: 16,
  /** Below the header, before the focus card. */
  header: 8,
} as const;

export const BOX_WIDTH = { min: 240, max: 320, rowMin: 200 } as const;

export const right = (b: Box) => b.left + b.width;
export const bottom = (b: Box) => b.top + b.height;
export const centerX = (b: Box) => b.left + b.width / 2;
export const centerY = (b: Box) => b.top + b.height / 2;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** The box grown by `pad` on every side and kept inside the window. */
export function cutoutOf(focus: Box, pad: number, frame: Frame): Box {
  const left = Math.max(0, focus.left - pad);
  const top = Math.max(0, focus.top - pad);
  const r = Math.min(frame.width, right(focus) + pad);
  const b = Math.min(frame.height, bottom(focus) + pad);
  return {
    left,
    top,
    width: Math.max(0, r - left),
    height: Math.max(0, b - top),
  };
}

/** The box grown by `pad` on every side, wherever it is (for sizes). */
export function inflate(box: Box, pad: number): Box {
  return {
    left: box.left - pad,
    top: box.top - pad,
    width: box.width + 2 * pad,
    height: box.height + 2 * pad,
  };
}

/** The union of several boxes: a stop may light more than one element. */
export function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const r = Math.max(...boxes.map(right));
  const b = Math.max(...boxes.map(bottom));
  return { left, top, width: r - left, height: b - top };
}

/** The part of `box` inside `clip`, or null where they do not overlap. */
export function intersect(box: Box, clip: Box): Box | null {
  const left = Math.max(box.left, clip.left);
  const top = Math.max(box.top, clip.top);
  const r = Math.min(right(box), right(clip));
  const b = Math.min(bottom(box), bottom(clip));
  return r > left && b > top
    ? { left, top, width: r - left, height: b - top }
    : null;
}

/** Whether `inner` lies wholly inside `outer`. */
export function within(inner: Box, outer: Box): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    right(inner) <= right(outer) + 0.5 &&
    bottom(inner) <= bottom(outer) + 0.5
  );
}

/** The band boxes may use: between the sticky header and the dock. */
function boxBand(frame: Frame): {
  readonly top: number;
  readonly bottom: number;
} {
  return {
    top: Math.max(SPACE.edge, frame.headerBottom + SPACE.header),
    bottom: frame.dockTop - SPACE.edge,
  };
}

/** The band the focus card must stay in: below the header, above the dock. */
export function cardBand(frame: Frame): {
  readonly top: number;
  readonly bottom: number;
} {
  return {
    top: frame.headerBottom + SPACE.header,
    bottom: frame.dockTop - SPACE.edge,
  };
}

// ─── Gutter ──────────────────────────────────────────────────────────────────

/** Box width in the gutters, or null where neither side has room. */
export function gutterWidth(frame: Frame, cutout: Box): number | null {
  const widths = [cutout.left, frame.width - right(cutout)]
    .filter((space) => space >= SPACE.gutter + BOX_WIDTH.min + SPACE.edge)
    .map((space) => Math.min(BOX_WIDTH.max, space - SPACE.gutter - SPACE.edge));
  return widths.length === 0 ? null : Math.floor(Math.min(...widths));
}

function gutterSides(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
): readonly ("left" | "right")[] | null {
  const room = SPACE.gutter + BOX_WIDTH.min + SPACE.edge;
  const usable = {
    left: cutout.left >= room,
    right: frame.width - right(cutout) >= room,
  };
  if (!usable.left && !usable.right) return null;
  return targets.map((target) => {
    const x = target === null ? centerX(cutout) : centerX(target);
    const nearer = x - cutout.left <= right(cutout) - x ? "left" : "right";
    if (usable[nearer]) return nearer;
    return nearer === "left" ? "right" : "left";
  });
}

/** Whether the gutters hold every box of the stop, sizes only. */
export function gutterFits(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
): boolean {
  const band = cardBand(frame);
  if (cutout.height > band.bottom - band.top) return false;
  const sides = gutterSides(frame, cutout, targets);
  if (sides === null) return false;
  const room = boxBand(frame);
  for (const side of ["left", "right"] as const) {
    const stack = heights.filter((_, i) => sides[i] === side);
    const total =
      stack.reduce((sum, h) => sum + h, 0) +
      Math.max(0, stack.length - 1) * SPACE.stack;
    if (total > room.bottom - room.top) return false;
  }
  return true;
}

/** Places the boxes in the gutters, each beside its target as far as it can. */
export function placeGutter(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
  width: number,
): readonly Placed[] {
  const sides =
    gutterSides(frame, cutout, targets) ?? targets.map(() => "right" as const);
  const band = boxBand(frame);
  const placed: Placed[] = new Array<Placed>(targets.length);
  for (const side of ["left", "right"] as const) {
    const order = targets
      .map((target, i) => ({
        i,
        y: target === null ? centerY(cutout) : centerY(target),
      }))
      .filter(({ i }) => sides[i] === side)
      .sort((a, b) => a.y - b.y);
    const tops: number[] = [];
    let floor = band.top;
    for (const { i, y } of order) {
      const h = heights[i] ?? 0;
      const top = Math.max(y - h / 2, floor);
      tops.push(top);
      floor = top + h + SPACE.stack;
    }
    // Pushed past the band at the bottom: move the whole stack up.
    const last = order.at(-1);
    if (last !== undefined) {
      const overflow =
        (tops.at(-1) ?? 0) + (heights[last.i] ?? 0) - band.bottom;
      if (overflow > 0) {
        for (let k = 0; k < tops.length; k += 1) {
          tops[k] = Math.max(band.top, (tops[k] ?? 0) - overflow);
        }
      }
    }
    order.forEach(({ i }, k) => {
      const box: Box = {
        left:
          side === "right"
            ? right(cutout) + SPACE.gutter
            : cutout.left - SPACE.gutter - width,
        top: tops[k] ?? band.top,
        width,
        height: heights[i] ?? 0,
      };
      placed[i] = {
        box,
        side,
        ...gutterLine(box, side, cutout, targets[i] ?? null),
      };
    });
  }
  return placed;
}

function gutterLine(
  box: Box,
  side: "left" | "right",
  cutout: Box,
  target: Box | null,
): Pick<Placed, "line" | "ring"> {
  if (target === null) return { line: null, ring: null };
  const y = centerY(target);
  const ring: Point = [
    side === "right" ? right(target) + SPACE.ring : target.left - SPACE.ring,
    y,
  ];
  const edge = side === "right" ? box.left : right(box);
  const leave = clamp(y, box.top + SPACE.inset, bottom(box) - SPACE.inset);
  if (Math.abs(leave - y) < 0.5) return { line: [[edge, y], ring], ring };
  const elbow =
    side === "right"
      ? right(cutout) + SPACE.gutter / 2
      : cutout.left - SPACE.gutter / 2;
  return { line: [[edge, leave], [elbow, leave], [elbow, y], ring], ring };
}

// ─── Row ─────────────────────────────────────────────────────────────────────

/** Box width in a row of `count` boxes, or null where they do not fit across. */
export function rowWidth(frame: Frame, count: number): number | null {
  const n = Math.max(1, count);
  const w = Math.min(
    BOX_WIDTH.max,
    (frame.width - 2 * SPACE.edge - (n - 1) * SPACE.beside) / n,
  );
  return w >= BOX_WIDTH.rowMin ? Math.floor(w) : null;
}

/** Which row each box goes in, before trying everything below or above. */
function rowSidesTried(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
): readonly (readonly ("above" | "below")[])[] {
  const middle = centerY(cutout);
  const level = targets.every(
    (t) => t === null || Math.abs(centerY(t) - middle) <= 24,
  );
  const roomier =
    cutout.top - SPACE.edge >= frame.dockTop - SPACE.edge - bottom(cutout)
      ? "above"
      : "below";
  const natural = targets.map((t) =>
    level || t === null ? roomier : centerY(t) < middle ? "above" : "below",
  );
  return [
    natural,
    targets.map(() => "below" as const),
    targets.map(() => "above" as const),
  ];
}

/** The band the card must sit in for rows of these heights, by sizes only. */
export function rowCardBand(
  frame: Frame,
  sides: readonly ("above" | "below")[],
  heights: readonly number[],
): { readonly top: number; readonly bottom: number } {
  const tallest = (side: "above" | "below") =>
    Math.max(0, ...heights.filter((_, i) => sides[i] === side));
  const card = cardBand(frame);
  const above = sides.includes("above") ? tallest("above") + SPACE.row : 0;
  const below = sides.includes("below") ? tallest("below") + SPACE.row : 0;
  return {
    top: Math.max(card.top, boxBand(frame).top + above),
    bottom: card.bottom - below,
  };
}

/** The first row arrangement that holds every box of the stop, or null. */
export function rowFit(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
): readonly ("above" | "below")[] | null {
  if (rowWidth(frame, targets.length) === null) return null;
  for (const sides of rowSidesTried(frame, cutout, targets)) {
    const band = rowCardBand(frame, sides, heights);
    if (band.bottom - band.top >= cutout.height) return sides;
  }
  return null;
}

/** Places the boxes in rows above and below the card, each near its target. */
export function placeRow(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
  width: number,
  sides: readonly ("above" | "below")[],
): readonly Placed[] {
  const placed: Placed[] = new Array<Placed>(targets.length);
  for (const side of ["above", "below"] as const) {
    const order = targets
      .map((target, i) => ({
        i,
        x: target === null ? centerX(cutout) : centerX(target),
      }))
      .filter(({ i }) => sides[i] === side)
      .sort((a, b) => a.x - b.x);
    const lefts: number[] = [];
    let floor = SPACE.edge;
    for (const { x } of order) {
      const left = Math.max(x - width / 2, floor);
      lefts.push(left);
      floor = left + width + SPACE.beside;
    }
    const overflow = (lefts.at(-1) ?? 0) + width - (frame.width - SPACE.edge);
    if (overflow > 0) {
      for (let k = 0; k < lefts.length; k += 1) {
        lefts[k] = Math.max(SPACE.edge, (lefts[k] ?? 0) - overflow);
      }
    }
    order.forEach(({ i }, k) => {
      const h = heights[i] ?? 0;
      const box: Box = {
        left: lefts[k] ?? SPACE.edge,
        top:
          side === "above"
            ? cutout.top - SPACE.row - h
            : bottom(cutout) + SPACE.row,
        width,
        height: h,
      };
      placed[i] = {
        box,
        side,
        ...rowLine(box, side, cutout, targets[i] ?? null),
      };
    });
  }
  return placed;
}

function rowLine(
  box: Box,
  side: "above" | "below",
  cutout: Box,
  target: Box | null,
): Pick<Placed, "line" | "ring"> {
  if (target === null) return { line: null, ring: null };
  const x = centerX(target);
  const ring: Point = [
    x,
    side === "above" ? target.top - SPACE.ring : bottom(target) + SPACE.ring,
  ];
  const edge = side === "above" ? bottom(box) : box.top;
  const leave = clamp(x, box.left + SPACE.inset, right(box) - SPACE.inset);
  if (Math.abs(leave - x) < 0.5) return { line: [[x, edge], ring], ring };
  const elbow =
    side === "above"
      ? cutout.top - SPACE.row / 2
      : bottom(cutout) + SPACE.row / 2;
  return { line: [[leave, edge], [leave, elbow], [x, elbow], ring], ring };
}

// ─── Choosing, scrolling, drawing ────────────────────────────────────────────

export type Presentation =
  | { readonly mode: "gutter"; readonly width: number }
  | {
      readonly mode: "row";
      readonly width: number;
      readonly sides: readonly ("above" | "below")[];
    }
  | { readonly mode: "sheet" };

/**
 * The stop's presentation, from the sizes of the window, the card and every
 * box (heights at the gutter and the row width). A phone always gets the sheet.
 */
export function choose(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: {
    readonly gutter: readonly number[];
    readonly row: readonly number[];
  },
  prefer: "gutter" | "row",
  /** A phone's window, as the stylesheet's media query sees it. */
  phone: boolean = frame.width <= WIDE,
): Presentation {
  if (phone) return { mode: "sheet" };
  const tryGutter = (): Presentation | null => {
    const width = gutterWidth(frame, cutout);
    return width !== null && gutterFits(frame, cutout, targets, heights.gutter)
      ? { mode: "gutter", width }
      : null;
  };
  const tryRow = (): Presentation | null => {
    const width = rowWidth(frame, targets.length);
    const sides = rowFit(frame, cutout, targets, heights.row);
    return width !== null && sides !== null
      ? { mode: "row", width, sides }
      : null;
  };
  const order = prefer === "gutter" ? [tryGutter, tryRow] : [tryRow, tryGutter];
  for (const attempt of order) {
    const found = attempt();
    if (found !== null) return found;
  }
  return { mode: "sheet" };
}

/**
 * How far to scroll the window so `subject` sits in the middle of `band`, or
 * its top at the band's top where it is taller than the band.
 */
export function scrollDelta(
  subject: Box,
  band: { readonly top: number; readonly bottom: number },
): number {
  const height = band.bottom - band.top;
  if (subject.height > height) return subject.top - band.top;
  return centerY(subject) - (band.top + height / 2);
}

/**
 * The scrollLeft that centers `target` in a sideways scroller, or null where
 * the target is already wholly in view. What scrolls is the padding box
 * (`clientLeft` past the border box's edge, `clientWidth` wide): measuring
 * against the border box would stop a bordered table short of its last column.
 */
export function scrollLeftFor(
  scroller: {
    readonly box: Box;
    readonly clientLeft: number;
    readonly clientWidth: number;
    readonly scrollLeft: number;
    readonly scrollWidth: number;
  },
  target: Box,
): number | null {
  const view: Box = {
    ...scroller.box,
    left: scroller.box.left + scroller.clientLeft,
    width: scroller.clientWidth,
  };
  if (target.left >= view.left && right(target) <= right(view)) return null;
  const wanted = scroller.scrollLeft + centerX(target) - centerX(view);
  return clamp(
    Math.round(wanted),
    0,
    Math.max(0, scroller.scrollWidth - scroller.clientWidth),
  );
}

/** An SVG path for a rectangle with rounded corners. */
export function roundedRect(box: Box, radius: number): string {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const x = box.left;
  const y = box.top;
  const w = box.width;
  const h = box.height;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + w - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}`,
    `V${n(y + h - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`,
    `H${n(x + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}`,
    `V${n(y + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/** The dim: the whole window with the cutout left open (even-odd). */
export function dimPath(
  frame: Frame,
  cutout: Box | null,
  radius: number,
): string {
  const outer = `M0 0H${String(frame.width)}V${String(frame.height)}H0Z`;
  return cutout === null ? outer : `${outer} ${roundedRect(cutout, radius)}`;
}

/** An SVG path through `points`. */
export function linePath(points: readonly Point[]): string {
  return points
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"}${String(Math.round(x * 100) / 100)} ${String(Math.round(y * 100) / 100)}`,
    )
    .join(" ");
}
