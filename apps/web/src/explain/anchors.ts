/**
 * Explainer anchors: the names by which an explanation points at an element on
 * a screen (ADR 0016). A screen spreads `explain(name, key)` onto the element,
 * and the guided tour finds it by that name, never by a class or an id, so
 * restyling a screen cannot silently move what an explanation points at. The
 * names outlive the tour: they are meant to carry "why" text on the review of
 * the user's own files too.
 *
 * Each name says how its element is measured: "box" for a card, chip, button
 * or field (its border box), "text" for a table cell or a span of text (the
 * extent of its text, so a line ends at the words and not at a wide cell's
 * padding).
 */

const ANCHORS = {
  "files.list": "box",
  "files.text": "text",
  "details.form": "box",
  "details.taxNumber": "box",
  "summary.gainsTax": "box",
  "summary.estimateChip": "box",
  "summary.netBase": "box",
  "summary.buckets": "box",
  "sec.item": "box",
  "sec.summary": "box",
  "sec.symbol": "box",
  "sec.gain": "box",
  "sec.rows": "box",
  "sec.lots": "box",
  "sec.row": "box",
  "sec.split": "text",
  "sec.quantity": "text",
  "sec.rate": "text",
  "sec.source": "text",
  "lot.row": "box",
  "lot.bought": "text",
  "lot.quantity": "text",
  "lot.bucket": "box",
  "div.row": "box",
  "div.gross": "text",
  "div.foreignTax": "text",
  "div.credit": "text",
  "div.rate": "text",
  "notes.noneBlocking": "box",
  "notes.group": "box",
  "notes.item": "box",
  "download.form": "box",
  "download.title": "text",
  "download.fileName": "box",
  "download.button": "box",
} as const satisfies Record<string, "box" | "text">;

export type ExplainName = keyof typeof ANCHORS;

/** The attributes an anchored element carries; spread them onto it. */
export interface ExplainProps {
  readonly "data-explain": ExplainName;
  readonly "data-explain-key"?: string;
}

/**
 * The attributes that mark an element as `name`. A `key` tells repeated
 * elements apart (a security by its ISIN, a row by its kind and date) and must
 * be unique among the elements of that name inside the same anchored parent.
 */
export function explain(name: ExplainName, key?: string): ExplainProps {
  return key === undefined
    ? { "data-explain": name }
    : { "data-explain": name, "data-explain-key": key };
}

/** How an element of this name is measured. */
export function measureOf(name: ExplainName): "box" | "text" {
  return ANCHORS[name];
}

/** Every anchor name: tour.test.tsx checks that a screen marks each one. */
export const EXPLAIN_NAMES = Object.freeze(
  Object.keys(ANCHORS) as ExplainName[],
);

/** One step of a path: an anchor name, and its key where it repeats. */
export interface AnchorRef {
  readonly name: ExplainName;
  readonly key?: string;
}

/** From an outer anchor to an inner one: each step is found inside the last. */
export type AnchorPath = readonly AnchorRef[];

/** A step of `path`: a name, or a name and its key. */
export type PathStep = ExplainName | readonly [ExplainName, string];

/** Builds a path; a shorthand for `[{ name, key }, ...]`. */
export function path(...steps: PathStep[]): AnchorPath {
  return steps.map((step) =>
    typeof step === "string" ? { name: step } : { name: step[0], key: step[1] },
  );
}

/**
 * The element at the end of `anchors`, or null where any step is missing.
 *
 * Only the name goes into a selector: names are a closed set known when the
 * app is built. A key is compared as text, never parsed, because keys will
 * come from the user's own files (a file name may hold a newline, which no
 * quoting makes safe inside a CSS string, and NUL never matches at all).
 */
export function resolve(root: ParentNode, anchors: AnchorPath): Element | null {
  let found: Element | null = null;
  let scope: ParentNode = root;
  for (const ref of anchors) {
    found = null;
    for (const element of scope.querySelectorAll(
      `[data-explain="${ref.name}"]`,
    )) {
      if (
        ref.key === undefined ||
        element.getAttribute("data-explain-key") === ref.key
      ) {
        found = element;
        break;
      }
    }
    if (found === null) return null;
    scope = found;
  }
  return found;
}

/**
 * The key a finding is anchored by: its code and the security or broker it is
 * about, which tells the demo's notes apart (two splits are two securities).
 */
export function findingKey(finding: {
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;
}): string {
  const about = finding.params["isin"] ?? finding.params["broker"];
  return `${finding.code}@${typeof about === "string" ? about : ""}`;
}

/** A path written as text, for test messages and keys. */
export function describe(anchors: AnchorPath): string {
  return anchors
    .map((ref) =>
      ref.key === undefined ? ref.name : `${ref.name}[${ref.key}]`,
    )
    .join(" > ");
}
