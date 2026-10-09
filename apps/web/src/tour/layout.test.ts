import { describe, expect, it } from "vitest";

import {
  bottom,
  choose,
  cutoutOf,
  dimPath,
  gutterWidth,
  linePath,
  placeGutter,
  placeRow,
  right,
  rowCardBand,
  rowWidth,
  scrollDelta,
  scrollLeftFor,
  SPACE,
  union,
  within,
  type Box,
  type Frame,
  type Placed,
} from "./layout";

const frame = (width: number, height: number): Frame => ({
  width,
  height,
  headerBottom: 64,
  dockTop: height - 120,
});

const overlaps = (a: Box, b: Box) =>
  a.left < right(b) &&
  b.left < right(a) &&
  a.top < bottom(b) &&
  b.top < bottom(a);

/** The promises every placement keeps, whatever the window. */
function expectSound(f: Frame, cutout: Box, placed: readonly Placed[]): void {
  for (const p of placed) {
    expect(overlaps(p.box, cutout), "a box covers the card").toBe(false);
    expect(p.box.left).toBeGreaterThanOrEqual(SPACE.edge - 0.5);
    expect(right(p.box)).toBeLessThanOrEqual(f.width - SPACE.edge + 0.5);
    if (p.line !== null && p.ring !== null) {
      expect(p.line.at(-1)).toEqual(p.ring);
    }
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (a && b)
        expect(overlaps(a.box, b.box), "two boxes overlap").toBe(false);
    }
  }
}

/** A card of the container's width (1200px max, 24px padding), centered. */
const fullWidthCard = (f: Frame, top: number, height: number): Box => {
  const width = Math.min(1200, f.width) - 48;
  return { left: (f.width - width) / 2, top, width, height };
};

describe("the cutout", () => {
  it("grows the card by its padding and stays inside the window", () => {
    const f = frame(1280, 800);
    expect(
      cutoutOf({ left: 4, top: 100, width: 200, height: 50 }, 8, f),
    ).toEqual({
      left: 0,
      top: 92,
      width: 212,
      height: 66,
    });
  });

  it("covers every element a stop lights", () => {
    expect(
      union([
        { left: 10, top: 10, width: 10, height: 10 },
        { left: 40, top: 30, width: 10, height: 10 },
      ]),
    ).toEqual({ left: 10, top: 10, width: 40, height: 30 });
    expect(union([])).toBeNull();
  });
});

describe("beside the card", () => {
  const f = frame(1440, 900);
  // The gains-tax card: the left seven twelfths of a 1200px container.
  const card: Box = { left: 144, top: 200, width: 676, height: 300 };
  const cutout = cutoutOf(card, 8, f);
  const targets: Box[] = [
    { left: 740, top: 220, width: 64, height: 24 },
    { left: 160, top: 330, width: 640, height: 28 },
    { left: 160, top: 400, width: 640, height: 80 },
  ];

  it("uses the gutter that has room, never covering the card", () => {
    const width = gutterWidth(f, cutout);
    expect(width).toBe(320);
    const heights = [70, 90, 90];
    const presentation = choose(
      f,
      cutout,
      targets,
      { gutter: heights, row: heights },
      "gutter",
    );
    expect(presentation.mode).toBe("gutter");
    const placed = placeGutter(f, cutout, targets, heights, width ?? 0);
    expectSound(f, cutout, placed);
    for (const p of placed) {
      expect(p.side).toBe("right");
      expect(p.box.top).toBeGreaterThanOrEqual(f.headerBottom + SPACE.header);
      expect(bottom(p.box)).toBeLessThanOrEqual(f.dockTop - SPACE.edge);
    }
  });

  it("draws a straight line where the box can sit level with its target", () => {
    const placed = placeGutter(f, cutout, [targets[0] ?? null], [70], 320);
    expect(placed[0]?.line).toHaveLength(2);
  });

  it("finds no gutter beside a card as wide as the container", () => {
    const wide = cutoutOf(fullWidthCard(f, 200, 300), 8, f);
    expect(gutterWidth(f, wide)).toBeNull();
  });
});

describe("above and below the card", () => {
  for (const width of [768, 1024, 1280, 1440]) {
    it(`keeps every box off the card at ${String(width)}px`, () => {
      const f = frame(width, 900);
      const card = fullWidthCard(f, 0, 220);
      const targets: Box[] = [
        { left: card.left + 120, top: 0, width: 60, height: 20 },
        { left: right(card) - 300, top: 0, width: 80, height: 20 },
        { left: right(card) - 140, top: 0, width: 120, height: 20 },
      ];
      const heights = [80, 100, 90];
      const sides = ["above", "below", "below"] as const;
      // Scroll so the card sits in the band its rows leave it.
      const band = rowCardBand(f, sides, heights);
      const shift = -scrollDelta({ ...card, top: 0 }, band);
      const placedCard = { ...card, top: shift };
      const cutout = cutoutOf(placedCard, 8, f);
      const moved = targets.map((t, i) => ({ ...t, top: shift + 10 + i * 90 }));
      const w = rowWidth(f, 3);
      expect(w).not.toBeNull();
      const placed = placeRow(f, cutout, moved, heights, w ?? 0, sides);
      expectSound(f, cutout, placed);
      for (const p of placed) {
        expect(p.box.top).toBeGreaterThanOrEqual(
          f.headerBottom + SPACE.header - 0.5,
        );
        expect(bottom(p.box)).toBeLessThanOrEqual(f.dockTop - SPACE.edge + 0.5);
      }
    });
  }

  it("is chosen for a full-width card, and falls to the sheet when too tall", () => {
    const f = frame(1280, 800);
    const card = cutoutOf(fullWidthCard(f, 200, 200), 8, f);
    const targets: Box[] = [{ left: 300, top: 220, width: 80, height: 20 }];
    expect(
      choose(f, card, targets, { gutter: [90], row: [90] }, "gutter").mode,
    ).toBe("row");
    const tall = cutoutOf(fullWidthCard(f, 100, 600), 8, f);
    expect(
      choose(f, tall, targets, { gutter: [90], row: [90] }, "row").mode,
    ).toBe("sheet");
  });
});

describe("one at a time", () => {
  it("is what a phone gets, whatever fits", () => {
    for (const width of [320, 390, 719]) {
      const f = frame(width, 800);
      const card = cutoutOf(
        { left: 16, top: 200, width: width - 32, height: 100 },
        8,
        f,
      );
      expect(
        choose(f, card, [null], { gutter: [60], row: [60] }, "row"),
      ).toEqual({
        mode: "sheet",
      });
    }
  });
});

describe("scrolling into view", () => {
  it("centers the subject in its band, or aligns the top of a tall one", () => {
    const band = { top: 100, bottom: 500 };
    expect(
      scrollDelta({ left: 0, top: 700, width: 10, height: 100 }, band),
    ).toBe(450);
    expect(
      scrollDelta({ left: 0, top: 700, width: 10, height: 900 }, band),
    ).toBe(600);
  });

  it("scrolls a table sideways only to bring a clipped cell into view", () => {
    const scroller = {
      box: { left: 20, top: 0, width: 300, height: 200 },
      scrollLeft: 0,
      scrollWidth: 900,
    };
    expect(
      scrollLeftFor(scroller, { left: 40, top: 0, width: 50, height: 20 }),
    ).toBeNull();
    expect(
      scrollLeftFor(scroller, { left: 600, top: 0, width: 80, height: 20 }),
    ).toBe(470);
    expect(
      scrollLeftFor(scroller, { left: 1200, top: 0, width: 80, height: 20 }),
    ).toBe(600);
  });
});

describe("drawing", () => {
  it("leaves the cutout open in the dim", () => {
    const f = frame(400, 300);
    expect(dimPath(f, null, 8)).toBe("M0 0H400V300H0Z");
    expect(
      dimPath(f, { left: 10, top: 10, width: 100, height: 50 }, 8),
    ).toMatch(/^M0 0H400V300H0Z M18 10 /);
  });

  it("draws a line through its points", () => {
    expect(
      linePath([
        [0, 0],
        [10.004, 5],
      ]),
    ).toBe("M0 0 L10 5");
  });

  it("knows when one box lies inside another", () => {
    const outer = { left: 0, top: 0, width: 100, height: 100 };
    expect(within({ left: 10, top: 10, width: 20, height: 20 }, outer)).toBe(
      true,
    );
    expect(within({ left: 90, top: 10, width: 20, height: 20 }, outer)).toBe(
      false,
    );
  });
});
