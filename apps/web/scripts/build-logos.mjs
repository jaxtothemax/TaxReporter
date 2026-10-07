#!/usr/bin/env node
/**
 * Builds apps/web/src/ui/logos.ts: company logo glyphs for the securities
 * investors most often hold, keyed by ISIN, from the Simple Icons package
 * (CC0-1.0, https://simpleicons.org).
 *
 * The logos ship inside the app. Fetching them from a logo service would tell
 * that service which securities the user holds, and the app makes no
 * third-party requests (CLAUDE.md, "Privacy"). A security without an entry
 * here keeps its ticker tile.
 *
 * Usage:
 *   curl -sO https://registry.npmjs.org/simple-icons/-/simple-icons-16.34.0.tgz
 *   mkdir si && tar -xzf simple-icons-16.34.0.tgz -C si
 *   node apps/web/scripts/build-logos.mjs si/package
 *
 * The package is read as data only; none of its code runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "16.34.0";
const OUT = new URL("../src/ui/logos.ts", import.meta.url);

/**
 * ISIN, Simple Icons title, and the icon's file name (its slug). Only brands
 * the package covers with no license of their own; ETF issuers (Vanguard,
 * iShares, Amundi, Xtrackers, SPDR) are not in it, so funds keep a tile.
 */
const LOGOS = [
  ["US0378331005", "Apple", "apple"],
  ["US67066G1040", "NVIDIA", "nvidia"],
  ["US88160R1014", "Tesla", "tesla"],
  ["US02079K3059", "Google", "google"], // Alphabet class A
  ["US02079K1079", "Google", "google"], // Alphabet class C
  ["US30303M1027", "Meta", "meta"],
  ["US92826C8394", "Visa", "visa"],
  ["US57636Q1040", "Mastercard", "mastercard"],
  ["US1912161007", "Coca-Cola", "cocacola"],
  ["US64110L1061", "Netflix", "netflix"],
  ["US4581401001", "Intel", "intel"],
  ["US0079031078", "AMD", "amd"],
  ["US00206R1023", "AT&T", "atandt"],
  ["US5801351017", "McDonald's", "mcdonalds"],
  ["US6541061031", "Nike", "nike"],
  ["US69608A1088", "Palantir", "palantir"],
  ["US7475251036", "Qualcomm", "qualcomm"],
  ["US90353T1007", "Uber", "uber"],
  ["US0090661010", "Airbnb", "airbnb"],
  ["US19260Q1076", "Coinbase", "coinbase"],
  ["US70450Y1038", "PayPal", "paypal"],
  ["CA82509L1076", "Shopify", "shopify"],
  ["LU1778762911", "Spotify", "spotify"],
  ["GB00B10RZP78", "Unilever", "unilever"],
  ["GB00BP6MXD84", "Shell", "shell"],
  ["DE0007164600", "SAP", "sap"],
  ["DE0007236101", "Siemens", "siemens"],
  ["DE0007664039", "Volkswagen", "volkswagen"],
  ["DE0005190003", "BMW", "bmw"],
  ["DE000A1EWWW0", "adidas", "adidas"],
];

/** ISO 6166 check digit, so a typo cannot attach a logo to the wrong security. */
function isIsin(value) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value)) return false;
  const digits = [...value]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
    .join("");
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function luminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

const root = process.argv[2];
if (root === undefined) {
  console.error("usage: node build-logos.mjs <extracted simple-icons package>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (manifest.name !== "simple-icons" || manifest.version !== VERSION) {
  console.error(
    `expected simple-icons ${VERSION}, found ${manifest.name} ${manifest.version}`,
  );
  process.exit(1);
}
const data = JSON.parse(
  readFileSync(join(root, "data", "simple-icons.json"), "utf8"),
);
const icons = Array.isArray(data) ? data : data.icons;

const entries = LOGOS.map(([isin, title, slug]) => {
  if (!isIsin(isin)) throw new Error(`bad ISIN ${isin}`);
  const icon = icons.find((i) => i.slug === slug);
  if (icon === undefined || icon.title.toLowerCase() !== title.toLowerCase()) {
    throw new Error(`no icon ${slug} titled ${title}`);
  }
  if (icon.license !== undefined)
    throw new Error(`${title} has its own license`);
  if (!/^[0-9A-F]{6}$/.test(icon.hex))
    throw new Error(`bad color for ${title}`);
  const svg = readFileSync(join(root, "icons", `${slug}.svg`), "utf8");
  if (!svg.includes('viewBox="0 0 24 24"'))
    throw new Error(`unexpected viewBox for ${slug}`);
  const paths = [
    ...svg.matchAll(/<path d="([MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+)"\/>/g),
  ];
  if (paths.length !== 1) throw new Error(`expected one path in ${slug}`);
  // The glyph goes white on a dark brand color and near-black on a light
  // one: white when it has at least 2.5:1 against the color (decorative, so
  // the brand's own convention matters more than AA here).
  const white = 1.05 / (luminance(icon.hex) + 0.05);
  return {
    isin,
    title: icon.title,
    hex: icon.hex,
    dark: white < 2.5,
    path: paths[0][1],
  };
});

const body = entries
  .map(
    (e) =>
      `  ${JSON.stringify(e.isin)}: {\n    title: ${JSON.stringify(e.title)},\n    color: "#${e.hex}",\n    darkGlyph: ${String(e.dark)},\n    path: ${JSON.stringify(e.path)},\n  },`,
  )
  .join("\n");

writeFileSync(
  OUT,
  `/**
 * Company logo glyphs by ISIN. GENERATED by apps/web/scripts/build-logos.mjs
 * from simple-icons ${VERSION} (CC0-1.0); do not edit by hand.
 *
 * The logos are trademarks of their owners, shown only to identify the
 * security they belong to; see the Simple Icons disclaimer
 * (https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).
 */

export interface Logo {
  readonly title: string;
  /** The brand's color, the tile's background. */
  readonly color: string;
  /** A near-black glyph instead of white, for a light brand color. */
  readonly darkGlyph: boolean;
  /** SVG path data on a 24 by 24 canvas. */
  readonly path: string;
}

export const LOGOS: Readonly<Record<string, Logo>> = {
${body}
};
`,
);
console.log(`wrote ${String(entries.length)} logos to ${OUT.pathname}`);
