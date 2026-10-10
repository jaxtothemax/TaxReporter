/**
 * The guided tour's modal layer (ADR 0016, #27). One <dialog>, opened with
 * showModal() for as long as the tour runs: the page behind it is inert, the
 * top layer clears the sticky header, and Escape closes it natively. Its
 * `close` event is the only way out; Skip, Escape and Finish all end there.
 *
 * The app shows the stop's screen, tab and rows in place of the user's (the
 * tour never navigates). This layer waits for the stop's elements, scrolls
 * them into view, measures them, and lets tour/layout.ts decide where the
 * explanations go. It draws the dim, the lines and the rings in one
 * aria-hidden SVG; the explanations themselves are an ordered list in the
 * dialog, so a screen reader reads them as text naming their targets.
 *
 * Every position reaches the page through React's `style` prop or a CSSOM
 * property write, which the production policy (`style-src 'self'`) allows;
 * never a style attribute, `cssText` or a <style> element.
 */
import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { measureOf, resolve, type AnchorPath } from "../explain/anchors";
import { formatNumber } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { ReturnPreview } from "../model/preview";
import { Button, cx } from "../ui/kit";
import {
  BOX_WIDTH,
  cardBand,
  centerY,
  choose,
  cutoutOf,
  dimPath,
  gutterWidth,
  inflate,
  intersect,
  linePath,
  placeGutter,
  placeRow,
  right,
  roundedRect,
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
  type Point,
  type Presentation,
  WIDE,
} from "./layout";
import { atEnd, atStart, inView, type TourRun } from "./machine";
import { TOUR, type NoteText, type TourStop } from "./script";

/** What the app gives back when the tour ends: recorded as the tour goes. */
export interface TourRestore {
  /**
   * The id of the element focus goes back to: the button that started the
   * tour where the page still shows it (the banner's replay, "Use demo
   * files"), or null for the heading of the screen the demo opened on. Named,
   * not taken from whatever had focus, since WebKit does not focus a button
   * on a click.
   */
  readonly focus: string | null;
  /** The window's scroll before the tour first scrolled it. */
  scrollY: number | null;
  /** Each sideways scroller the tour moved, and where it was. */
  readonly scrollers: Map<HTMLElement, number>;
}

/**
 * Whether the window is a phone's, by the same media query the stylesheet
 * uses, so the layout and the dock's shape agree at every width. Where no
 * window exists (a render on the server, in tests), it is taken as wide.
 */
function narrowWindow(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(`(max-width: ${String(WIDE)}px)`).matches
  );
}

/** The element focus goes back to when the tour ends. */
export function focusTarget(id: TourRestore["focus"]): HTMLElement | null {
  const button = id === null ? null : document.getElementById(id);
  return button ?? document.querySelector<HTMLElement>("#main h1");
}

/** The largest corner radius in the design system (--r-lg). */
const MAX_RADIUS = 16;

/** How long a stop waits for its elements before it goes on without them. */
const WAIT_MS = 3000;
/** How long it waits for a screen's entrance animation to finish. */
const SETTLE_MS = 900;
/** When a stop still waiting says so. */
const NOTICE_MS = 600;

const nextFrame = () =>
  new Promise<void>((done) => {
    requestAnimationFrame(() => {
      done();
    });
  });

const sleep = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });

function boxOf(rect: DOMRect): Box {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * An element's box, or for a "text" anchor the extent of its words: each
 * visible text node's own rectangles, so a line ends at the text and not at
 * a block's full width. Text hidden for screen readers is left out.
 */
function measure(element: Element, anchors: AnchorPath): Box {
  const last = anchors.at(-1);
  if (last !== undefined && measureOf(last.name) === "text") {
    const rects: Box[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      if ((node.textContent ?? "").trim() === "") continue;
      if (node.parentElement?.closest(".visually-hidden") != null) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) rects.push(boxOf(rect));
      }
    }
    const words = union(rects);
    if (words !== null) return words;
  }
  return boxOf(element.getBoundingClientRect());
}

/** The window, the header's bottom and the dock's top, as they are now. */
function readFrame(dock: HTMLElement | null): Frame {
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const header = document.querySelector(".app-header");
  return {
    width,
    height,
    headerBottom: header === null ? 0 : header.getBoundingClientRect().bottom,
    dockTop: dock === null ? height : dock.getBoundingClientRect().top,
  };
}

/** The sideways scrollers an element sits in, innermost first. */
function scrollersOf(element: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  let at = element.parentElement?.closest<HTMLElement>(".table-scroll") ?? null;
  while (at !== null) {
    found.push(at);
    at = at.parentElement?.closest<HTMLElement>(".table-scroll") ?? null;
  }
  return found;
}

/** The least of a target that must show for the sheet's ring to mark it. */
const MIN_PART = 12;

/**
 * A target's box where it is in view: inside the window, between the header
 * and the dock, and inside every scroller it sits in. A line needs the whole
 * target, so a target that is cut off gets its explanation as text with no
 * line pointing at it. The sheet's ring needs only part (`whole` false): a
 * target taller than the room a short window leaves above the sheet, or wider
 * than its table on a phone, is marked where it shows.
 */
function visibleBox(
  anchors: AnchorPath,
  frame: Frame,
  whole = true,
): Box | null {
  const element = resolve(document, anchors);
  if (element === null) return null;
  const box = measure(element, anchors);
  const view: Box = {
    left: 0,
    top: frame.headerBottom,
    width: frame.width,
    height: frame.dockTop - frame.headerBottom,
  };
  const clips = [
    view,
    ...scrollersOf(element).map((scroller) =>
      boxOf(scroller.getBoundingClientRect()),
    ),
  ];
  if (whole) return clips.every((clip) => within(box, clip)) ? box : null;
  let part: Box | null = box;
  for (const clip of clips) part = part === null ? null : intersect(part, clip);
  return part !== null && part.width >= MIN_PART && part.height >= MIN_PART
    ? part
    : null;
}

/** Polls each frame until `find` answers, or gives up after `ms`. */
async function waitFor<T>(find: () => T | null, ms: number): Promise<T | null> {
  const until = performance.now() + ms;
  for (;;) {
    const found = find();
    if (found !== null || performance.now() > until) return found;
    await nextFrame();
  }
}

/** Waits for the entrance animation of the screen or tab holding `elements`. */
async function settle(elements: readonly Element[]): Promise<void> {
  const hosts = new Set(
    elements
      .map((element) => element.closest(".screen, .tab-panel"))
      .filter((host): host is Element => host !== null),
  );
  const running = [...hosts].flatMap((host) => host.getAnimations());
  if (running.length === 0) return;
  await Promise.race([
    Promise.allSettled(running.map((animation) => animation.finished)),
    sleep(SETTLE_MS),
  ]);
}

interface Geometry {
  /** The stop and first explanation it was laid out for. */
  readonly key: string;
  readonly frame: Frame;
  /** The lit area, or null when the stop's card never appeared. */
  readonly cutout: Box | null;
  readonly radius: number;
  /** Where each explanation in view goes; null in the sheet. */
  readonly placed: readonly Placed[] | null;
  /** The ring on the current target in the sheet. */
  readonly sheetRing: Point | null;
}

export function TourLayer({
  run,
  preview,
  restore,
  onNext,
  onBack,
  onClosed,
}: {
  readonly run: TourRun;
  readonly preview: ReturnPreview;
  readonly restore: TourRestore;
  readonly onNext: (capacity: number) => void;
  readonly onBack: (capacity: number) => void;
  /** The dialog closed: Skip, Escape or Finish. */
  readonly onClosed: () => void;
}) {
  const { locale, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const measuring = useRef<HTMLOListElement>(null);
  const stop: TourStop | undefined = TOUR[run.stop];
  // Each layout is tagged with the stop (and, below, the explanations) it was
  // made for, and used only for those: a new stop never shows, even for a
  // frame, the boxes of the one before.
  const [chosen, setChosen] = useState<{
    readonly stop: number;
    readonly value: Presentation;
  } | null>(null);
  const presentation =
    chosen !== null && chosen.stop === run.stop ? chosen.value : null;
  const [heights, setHeights] = useState<{
    readonly gutter: readonly number[];
    readonly row: readonly number[];
  }>({ gutter: [], row: [] });
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  // Said while a stop's elements are awaited, or when they never came.
  const [notice, setNotice] = useState<"waiting" | "unavailable" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Bumped when a stop has been prepared: the next layout scrolls it into view.
  const [prepared, setPrepared] = useState(0);
  const scrolledFor = useRef(-1);

  const texts: readonly (NoteText | null)[] = useMemo(
    () =>
      stop === undefined
        ? []
        : stop.notes.map((note) => note.text({ t, locale, preview })),
    [stop, t, locale, preview],
  );
  const count = stop?.notes.length ?? 0;
  // While a stop is prepared, the capacity the window will most likely get,
  // so an early Next moves a stop and its label does not change underfoot.
  const capacity =
    presentation === null
      ? narrowWindow()
        ? 1
        : 3
      : presentation.mode === "sheet"
        ? 1
        : 3;
  const shown = inView(run, count, capacity);
  const total = TOUR.length;
  const last = atEnd(
    run,
    TOUR.map((s) => s.notes.length),
    capacity,
  );
  const first = atStart(run, capacity);
  const stopNumber = formatNumber(String(run.stop + 1), locale);
  const stopsNumber = formatNumber(String(total), locale);
  const title = stop?.title({ t, locale, preview }) ?? "";

  // Open as a modal once; StrictMode runs effects twice in development.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) {
      // The browser gives focus back, on close, to what had it when the
      // dialog opened; WebKit does so after the app's own restore. So the
      // element the tour returns to has focus first: the button that replayed
      // it, or the heading of the screen the demo opened on.
      focusTarget(restore.focus)?.focus({ preventScroll: true });
      // Next, not Skip, is focused when the dialog opens: Enter on the first
      // thing focused should go on. `autofocus` is what the dialog's own
      // focusing steps honor, in every browser.
      element.querySelector(".tour-next")?.setAttribute("autofocus", "");
      element.showModal();
    }
    element.querySelector<HTMLButtonElement>(".tour-next")?.focus();
  }, []);

  /** Lays the stop out where it is now, without scrolling. */
  const place = useCallback(() => {
    if (stop === undefined || presentation === null) return;
    const frame = readFrame(dock.current);
    const focusElements = stop.focus
      .map((anchors) => resolve(document, anchors))
      .filter((element): element is Element => element !== null);
    const lit = union(
      focusElements.map((element) => boxOf(element.getBoundingClientRect())),
    );
    if (lit === null) {
      setGeometry({
        key: `${String(run.stop)}:${String(shown.from)}`,
        frame,
        cutout: null,
        radius: 0,
        placed: null,
        sheetRing: null,
      });
      return;
    }
    const grown = inflate(lit, stop.pad);
    const firstElement = focusElements[0];
    const cornered =
      firstElement === undefined || firstElement.tagName === "TR"
        ? 0
        : parseFloat(getComputedStyle(firstElement).borderTopLeftRadius) || 0;
    // The lit element's own corner, grown with the padding; never rounder
    // than the largest radius of the design (--r-lg), so a pill among the lit
    // elements cannot turn the cutout into an ellipse.
    const radius =
      firstElement?.tagName === "TR"
        ? 8
        : Math.min(cornered, MAX_RADIUS) + stop.pad;
    const targets = stop.notes.map((note, i) =>
      i >= shown.from && i < shown.to ? visibleBox(note.target, frame) : null,
    );
    let placed: readonly Placed[] | null = null;
    let sheetRing: Point | null = null;
    if (presentation.mode === "gutter") {
      placed = placeGutter(
        frame,
        grown,
        targets,
        heights.gutter,
        presentation.width,
      );
    } else if (presentation.mode === "row") {
      placed = placeRow(
        frame,
        grown,
        targets,
        heights.row,
        presentation.width,
        presentation.sides,
      );
    } else {
      const note = stop.notes[shown.from];
      const target =
        note === undefined ? null : visibleBox(note.target, frame, false);
      if (target !== null) {
        const leftRing = target.left - SPACE.ring;
        sheetRing =
          leftRing >= SPACE.ring
            ? [leftRing, centerY(target)]
            : [right(target) + SPACE.ring, centerY(target)];
      }
    }
    setGeometry({
      key: `${String(run.stop)}:${String(shown.from)}`,
      frame,
      cutout: cutoutOf(lit, stop.pad, frame),
      radius,
      placed,
      sheetRing,
    });
  }, [stop, presentation, heights, shown.from, shown.to, run.stop]);

  /** Waits for the stop, scrolls its tables, measures, and picks a presentation. */
  const prepare = useCallback(
    async (isCancelled: () => boolean) => {
      if (stop === undefined) return;
      const forStop = run.stop;
      const noticeTimer = setTimeout(() => {
        if (!isCancelled()) setNotice("waiting");
      }, NOTICE_MS);
      const focus = await waitFor(() => {
        const found = stop.focus.map((anchors) => resolve(document, anchors));
        return found.every((element): element is Element => element !== null)
          ? found
          : null;
      }, WAIT_MS);
      clearTimeout(noticeTimer);
      if (isCancelled()) return;
      setNotice(focus === null ? "unavailable" : null);
      if (focus === null) {
        setChosen({ stop: forStop, value: { mode: "sheet" } });
        setPrepared((n) => n + 1);
        return;
      }
      await settle(focus);
      if (isCancelled()) return;
      const frame = readFrame(dock.current);
      const lit = union(
        focus.map((element) => boxOf(element.getBoundingClientRect())),
      );
      if (lit === null) return;
      const grown = inflate(lit, stop.pad);
      const targets = stop.notes.map((note) => {
        const element = resolve(document, note.target);
        return element === null ? null : measure(element, note.target);
      });
      // Each box's height at the width it would have beside or around the card.
      const items =
        measuring.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [];
      const heightsAt = (width: number) =>
        [...items].map((item) => {
          item.style.width = `${String(width)}px`;
          return item.getBoundingClientRect().height;
        });
      const measured = {
        gutter: heightsAt(gutterWidth(frame, grown) ?? BOX_WIDTH.max),
        row: heightsAt(rowWidth(frame, stop.notes.length) ?? BOX_WIDTH.rowMin),
      };
      setHeights(measured);
      setChosen({
        stop: forStop,
        value: choose(
          frame,
          grown,
          targets,
          measured,
          stop.prefer,
          narrowWindow(),
        ),
      });
      setPrepared((n) => n + 1);
    },
    [stop, restore, run.stop],
  );

  // Each stop, and each change of the window's size, is prepared afresh.
  const [sized, setSized] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setGeometry(null);
    setNotice(null);
    void prepare(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [prepare, run.stop, sized]);

  // Once prepared (and for each note in the sheet), scroll the stop into the
  // band it needs, then lay it out.
  useLayoutEffect(() => {
    if (stop === undefined || presentation === null || prepared === 0) return;
    const scrollKey =
      presentation.mode === "sheet"
        ? prepared * 1000 + shown.from
        : prepared * 1000;
    if (scrolledFor.current !== scrollKey) {
      scrolledFor.current = scrollKey;
      const frame = readFrame(dock.current);
      const focusElements = stop.focus
        .map((anchors) => resolve(document, anchors))
        .filter((element): element is Element => element !== null);
      const lit = union(
        focusElements.map((element) => boxOf(element.getBoundingClientRect())),
      );
      if (lit !== null) {
        const grown = inflate(lit, stop.pad);
        let subject: Box = grown;
        let band = cardBand(frame);
        if (presentation.mode === "row") {
          band = rowCardBand(frame, presentation.sides, heights.row);
        }
        // Sideways first, inside each table: the targets in view (one in
        // the sheet), all of them where they fit across the table.
        const inScope = stop.notes
          .map((note, i) => ({ note, i }))
          .filter(({ i }) => i >= shown.from && i < shown.to);
        const byScroller = new Map<HTMLElement, Box[]>();
        for (const { note } of inScope) {
          const element = resolve(document, note.target);
          if (element === null) continue;
          const [innermost] = scrollersOf(element);
          if (innermost === undefined) continue;
          byScroller.set(innermost, [
            ...(byScroller.get(innermost) ?? []),
            measure(element, note.target),
          ]);
        }
        for (const [scroller, boxes] of byScroller) {
          const box = boxOf(scroller.getBoundingClientRect());
          const all = union(boxes);
          const span = all !== null && all.width <= box.width ? all : boxes[0];
          if (span === undefined) continue;
          const wanted = scrollLeftFor(
            {
              box,
              clientLeft: scroller.clientLeft,
              clientWidth: scroller.clientWidth,
              scrollLeft: scroller.scrollLeft,
              scrollWidth: scroller.scrollWidth,
            },
            span,
          );
          if (wanted === null) continue;
          if (!restore.scrollers.has(scroller)) {
            restore.scrollers.set(scroller, scroller.scrollLeft);
          }
          scroller.scrollLeft = wanted;
        }
        if (presentation.mode === "sheet") {
          const note = stop.notes[shown.from];
          const element =
            note === undefined ? null : resolve(document, note.target);
          if (element !== null && note !== undefined)
            subject = measure(element, note.target);
        }
        const delta = scrollDelta(subject, band);
        if (Math.abs(delta) >= 1) {
          restore.scrollY ??= window.scrollY;
          window.scrollBy({ top: delta, behavior: "instant" });
        }
      }
    }
    place();
  }, [stop, presentation, prepared, shown.from, heights, place, restore]);

  // Follow the page: scrolling (the window or a table) and resizing.
  useEffect(() => {
    let pending = 0;
    const later = () => {
      if (pending !== 0) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        place();
      });
    };
    let lastSize = `${String(window.innerWidth)}x${String(window.innerHeight)}`;
    const resized = () => {
      const size = `${String(window.innerWidth)}x${String(window.innerHeight)}`;
      if (size === lastSize) return;
      lastSize = size;
      setSized((n) => n + 1);
    };
    window.addEventListener("scroll", later, { capture: true, passive: true });
    window.addEventListener("resize", resized);
    return () => {
      cancelAnimationFrame(pending);
      window.removeEventListener("scroll", later, { capture: true });
      window.removeEventListener("resize", resized);
    };
  }, [place]);

  // Say where the tour is, since focus stays on Next: the stop and its
  // introduction, and in the sheet the explanation in view; or that a stop is
  // still being prepared, or could not be shown.
  useEffect(() => {
    if (notice !== null) {
      setAnnouncement(
        notice === "waiting" ? t.tour.waiting : t.tour.unavailable,
      );
      return;
    }
    if (stop === undefined || presentation === null) return;
    const note = texts[shown.from];
    const intro = stop.intro({ t, locale, preview });
    const stopText = `${t.tour.announceStop(stopNumber, stopsNumber, title)} ${intro}`;
    setAnnouncement(
      presentation.mode === "sheet" && note != null
        ? `${shown.from === 0 ? `${stopText} ` : ""}${t.tour.announceNote(
            formatNumber(String(shown.from + 1), locale),
            formatNumber(String(count), locale),
            note.lead,
          )} ${note.body}`
        : stopText,
    );
  }, [
    notice,
    stop,
    presentation,
    shown.from,
    texts,
    count,
    t,
    locale,
    preview,
    stopNumber,
    stopsNumber,
    title,
  ]);

  if (stop === undefined) return null;
  // While a stop is prepared, the dock takes the shape the window will most
  // likely get, so the room measured for the explanations is the real room.
  const sheet =
    presentation === null ? narrowWindow() : presentation.mode === "sheet";
  // Only the layout made for what is in view now.
  const laid =
    geometry !== null &&
    geometry.key === `${String(run.stop)}:${String(shown.from)}`
      ? geometry
      : null;
  const placed = laid?.placed ?? null;
  const frame = laid?.frame;
  const close = () => {
    dialog.current?.close();
  };
  const noteItem = (index: number, positioned: Placed | null) => {
    const text = texts[index];
    if (text === null || text === undefined) return null;
    return (
      <li
        key={index}
        className={cx("tour-note", positioned !== null && "is-placed")}
        style={
          positioned === null
            ? undefined
            : {
                left: `${String(positioned.box.left)}px`,
                top: `${String(positioned.box.top)}px`,
                width: `${String(positioned.box.width)}px`,
              }
        }
      >
        <p className={cx("tour-note-lead", text.mono === true && "mono")}>
          {text.lead}
        </p>
        <p className="tour-note-body">{text.body}</p>
      </li>
    );
  };
  const indices = Array.from(
    { length: shown.to - shown.from },
    (_, k) => shown.from + k,
  );

  return (
    <dialog
      ref={dialog}
      className="tour"
      aria-labelledby="tour-title"
      aria-describedby="tour-intro"
      // For tests: the stop in view is laid out.
      data-ready={laid === null ? undefined : "true"}
      onClose={onClosed}
    >
      <svg className="tour-canvas" aria-hidden focusable="false">
        {/* Drawn from the moment the tour opens, the whole window dimmed
              until a stop is laid out: never a bright page between two stops.
              Coordinates are CSS pixels: the SVG fills the window unscaled. */}
        {frame === undefined ? (
          <rect className="tour-dim" width="100%" height="100%" />
        ) : (
          <path
            className="tour-dim"
            fillRule="evenodd"
            d={dimPath(frame, laid?.cutout ?? null, laid?.radius ?? 0)}
          />
        )}
        {laid?.cutout == null ? null : (
          <path
            className="tour-frame"
            d={roundedRect(laid.cutout, laid.radius)}
          />
        )}
        {placed?.map((p, k) =>
          p.line === null ? null : (
            <g key={`line-${String(k)}`}>
              <path className="tour-line-casing" d={linePath(p.line)} />
              <path className="tour-line" d={linePath(p.line)} />
            </g>
          ),
        )}
        {[...(placed?.map((p) => p.ring) ?? []), laid?.sheetRing ?? null].map(
          (ring, k) =>
            ring === null ? null : (
              <g key={`ring-${String(k)}`} className="tour-ring">
                <circle
                  className="tour-ring-halo"
                  cx={ring[0]}
                  cy={ring[1]}
                  r={8}
                />
                <circle
                  className="tour-ring-mark"
                  cx={ring[0]}
                  cy={ring[1]}
                  r={5.5}
                />
                <circle
                  className="tour-ring-pulse"
                  cx={ring[0]}
                  cy={ring[1]}
                  r={5.5}
                />
              </g>
            ),
        )}
      </svg>

      <div
        ref={dock}
        className={cx("tour-dock", sheet ? "is-sheet" : "is-wide")}
      >
        <div className="tour-progress" aria-hidden>
          <span
            className="tour-progress-fill"
            style={{ width: `${String(((run.stop + 1) / total) * 100)}%` }}
          />
        </div>
        <div className="tour-skip">
          <Button variant="ghost" size="sm" onClick={close}>
            {t.tour.skip}
          </Button>
        </div>
        <h2 id="tour-title" className="tour-title">
          <span className="tour-count">
            {t.tour.stopOf(stopNumber, stopsNumber)}
          </span>
          <span className="visually-hidden">: </span>
          <span className="tour-name">{title}</span>
        </h2>
        <p
          id="tour-intro"
          className={cx(
            "tour-intro",
            sheet && shown.from > 0 && "visually-hidden",
          )}
        >
          {stop.intro({ t, locale, preview })}
          {notice === null ? null : (
            <span className="tour-waiting muted small">
              {notice === "waiting" ? t.tour.waiting : t.tour.unavailable}
            </span>
          )}
        </p>
        <ol className="tour-notes" role="list" aria-label={t.tour.listLabel}>
          {indices.map((index) =>
            noteItem(
              index,
              sheet || placed === null ? null : (placed[index] ?? null),
            ),
          )}
        </ol>
        <div className="tour-controls">
          {sheet && count > 1 ? (
            <span className="tour-note-count" aria-hidden>
              {t.tour.noteOf(
                formatNumber(String(shown.from + 1), locale),
                formatNumber(String(count), locale),
              )}
            </span>
          ) : null}
          {/* Hidden from reading; aria-describedby still names Back with it. */}
          <span id="tour-at-start" hidden>
            {t.tour.atStart}
          </span>
          <Button
            variant="secondary"
            aria-disabled={first}
            aria-describedby={first ? "tour-at-start" : undefined}
            onClick={() => {
              if (!first) onBack(capacity);
            }}
          >
            {t.tour.back}
          </Button>
          <Button
            variant="primary"
            className="tour-next"
            onClick={() => {
              if (last) close();
              else onNext(capacity);
            }}
          >
            {last ? t.tour.finish : t.tour.next}
            {last ? (
              <CheckIcon size={18} weight="bold" aria-hidden />
            ) : (
              <ArrowRightIcon size={18} weight="bold" aria-hidden />
            )}
          </Button>
        </div>
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>

      <ol ref={measuring} className="tour-measure" aria-hidden>
        {stop.notes.map((_, index) => noteItem(index, null))}
      </ol>
    </dialog>
  );
}
