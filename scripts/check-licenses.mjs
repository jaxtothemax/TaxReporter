#!/usr/bin/env node
// scripts/check-licenses.mjs — every dependency's license must be compatible
// with this project's own, AGPL-3.0-or-later.
//
// ## Why this exists
//
// TaxReporter is AGPL-3.0-or-later. A dependency under a license that cannot be
// combined with it (GPL-2.0-only, SSPL, BUSL, a NonCommercial clause) or under
// no stated license at all makes the distributed work unlicensable, and nothing
// in the build, the tests or the type checker notices: the code works either
// way. The GitLab-era template denied `GPL-2.0;GPL-3.0;AGPL-3.0`, which is
// backwards for a project that is itself AGPL — it would have rejected licenses
// this project can use and accepted none of the actual problems by name.
//
// ## What this checks
//
// Every package `pnpm licenses list --json` reports for the workspace — all
// importers, production, development and optional dependencies alike. Dev
// tooling is not exempt: in a bundled single-page app a devDependency can end
// up in the shipped bundle, so "it is only a devDependency" is not evidence that
// it never ships. A package passes when its license expression is satisfied by
// the ALLOWLIST below (SPDX `OR` needs one allowed side, `AND` needs both,
// `WITH <exception>` is judged by its license). Everything else fails,
// including `Unknown`, `UNLICENSED`, `SEE LICENSE IN …` and any expression this
// script cannot parse: deny by default.
//
// ## What it does not cover
//
// Optional packages pnpm skipped on this platform (a Linux-only binary on a Mac)
// are not installed, so they are not reported. CI runs on Linux, which is what
// the shipped artifacts are built on. It reads the license each package
// DECLARES in its package.json; it does not read LICENSE files.
//
// ## Usage
//
//   node scripts/check-licenses.mjs [--root <dir>] [--input <licenses.json>]
//   node scripts/check-licenses.mjs --self-test
//
//   --root <dir>     workspace root (default: this script's repository)
//   --input <file>   read `pnpm licenses list --json` output from a file instead
//                    of running pnpm (the self-test uses this)
//
// ## Exit codes
//
//   0  every dependency's license is allowed or excepted with a reason, or there
//      is no pnpm-lock.yaml (nothing to check)
//   1  at least one dependency's license is not AGPL-3.0-compatible
//   2  could not check: pnpm missing or failing, output that is not the shape
//      `pnpm licenses list --json` emits, or an EXCEPTIONS entry with no reason

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ─── Policy ─────────────────────────────────────────────────────────────────
//
// Licenses that can be combined with AGPL-3.0-or-later code. Matched
// case-insensitively against SPDX identifiers (deprecated forms included:
// `GPL-3.0`, `LGPL-2.1+`).
const ALLOWED_IDS = new Set(
  [
    'MIT',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Apache-2.0',
    '0BSD',
    'CC0-1.0',
    'Unlicense',
    'BlueOak-1.0.0',
    'Python-2.0',
    'MPL-2.0',
    // CC BY 4.0 is GPLv3-compatible (FSF license list); the Banka Slovenije rate
    // data this project bundles is itself CC BY 4.0.
    'CC-BY-4.0',
  ].map((id) => id.toUpperCase()),
);
const ALLOWED_FAMILIES = [
  /^LGPL-(2\.0|2\.1|3\.0)(-only|-or-later|\+)?$/i, // LGPL-*
  /^GPL-2\.0(-or-later|\+)$/i, //                     GPL-2.0-or-later (may be used under GPL-3.0)
  /^GPL-3\.0(-only|-or-later|\+)?$/i, //              GPL-3.0-*
  /^AGPL-3\.0(-only|-or-later)?$/i, //                AGPL-3.0-*
];

// Named only so a failure says WHY; anything not allowed above fails anyway.
const KNOWN_INCOMPATIBLE = [
  [/^GPL-2\.0(-only)?$/i, 'GPL-2.0-only cannot move to GPL-3.0, so it cannot be combined with AGPL-3.0 code'],
  [/^SSPL/i, 'SSPL is not an open-source license, and its service clause conflicts with the AGPL'],
  [/^BUSL/i, 'BUSL is source-available, not open source, until its change date'],
  [/^CC-BY-NC/i, 'a NonCommercial clause is a further restriction the AGPL forbids'],
];

// A dependency the allowlist rejects but that was reviewed and is acceptable —
// a missing or non-SPDX license field whose real license was verified by hand,
// say. Matched on name AND the exact license string pnpm reports, so a later
// version that changes its license is checked again instead of inheriting the
// waiver. `reason` is required: an unexplained entry is how a list like this
// rots, one good reason nobody wrote down at a time.
const EXCEPTIONS = [];

// ─── SPDX expressions ───────────────────────────────────────────────────────

// Parses `MIT`, `(MIT OR Apache-2.0)`, `Apache-2.0 WITH LLVM-exception`, ...
// into a tree. Throws on anything that is not a well-formed expression.
function parseSpdx(expression) {
  const tokens = expression.replace(/([()])/g, ' $1 ').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const peek = () => (tokens[i] ?? '').toUpperCase();
  const isOperator = (t) => ['AND', 'OR', 'WITH', '(', ')'].includes(t.toUpperCase());

  function atom() {
    const t = tokens[i++];
    if (t === undefined) throw new Error('unexpected end of expression');
    let node;
    if (t === '(') {
      node = or();
      if (tokens[i++] !== ')') throw new Error('unbalanced parentheses');
    } else if (isOperator(t)) {
      throw new Error(`unexpected "${t}"`);
    } else {
      node = { id: t };
    }
    if (peek() === 'WITH') {
      i++;
      const exception = tokens[i++];
      if (exception === undefined || isOperator(exception)) throw new Error('WITH needs an exception id');
      node = { with: node, exception };
    }
    return node;
  }
  function and() {
    let node = atom();
    while (peek() === 'AND') {
      i++;
      node = { and: [node, atom()] };
    }
    return node;
  }
  function or() {
    let node = and();
    while (peek() === 'OR') {
      i++;
      node = { or: [node, and()] };
    }
    return node;
  }

  const tree = or();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}"`);
  return tree;
}

function idAllowed(id) {
  return ALLOWED_IDS.has(id.toUpperCase()) || ALLOWED_FAMILIES.some((re) => re.test(id));
}

function treeAllowed(node) {
  if (node.id !== undefined) return idAllowed(node.id);
  // An exception only ever grants permissions; judge the license it modifies.
  if (node.with !== undefined) return treeAllowed(node.with);
  if (node.or !== undefined) return node.or.some(treeAllowed);
  return node.and.every(treeAllowed);
}

// → null when allowed, else a one-line reason.
function licenseVerdict(license) {
  let tree;
  try {
    tree = parseSpdx(license);
  } catch (err) {
    return `not a license this gate can recognize (${err.message}) — deny by default`;
  }
  if (treeAllowed(tree)) return null;
  for (const [re, why] of KNOWN_INCOMPATIBLE) {
    if (re.test(license.replace(/[()]/g, '').trim())) return why;
  }
  return 'not on the AGPL-3.0-compatible allowlist — deny by default';
}

// ─── Core check ─────────────────────────────────────────────────────────────

class CouldNotCheck extends Error {}

// `pnpm licenses list --json` → [{ name, versions, license }]. Throws
// CouldNotCheck on anything that is not that shape: a gate that cannot read its
// input has not checked anything.
function packagesFrom(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new CouldNotCheck('expected an object keyed by license, as `pnpm licenses list --json` emits');
  }
  const packages = [];
  for (const [groupLicense, entries] of Object.entries(report)) {
    if (!Array.isArray(entries)) throw new CouldNotCheck(`license group "${groupLicense}" is not a list`);
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') {
        throw new CouldNotCheck(`an entry under "${groupLicense}" has no package name`);
      }
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const license = typeof entry.license === 'string' && entry.license.trim() ? entry.license : groupLicense;
      packages.push({ name: entry.name, versions, license });
    }
  }
  return packages;
}

function checkPackages(packages, exceptions) {
  for (const e of exceptions) {
    if (typeof e.reason !== 'string' || !e.reason.trim()) {
      throw new CouldNotCheck(`EXCEPTIONS entry for "${e.name}" has no reason`);
    }
  }
  const denied = [];
  let excepted = 0;
  for (const pkg of packages) {
    const why = licenseVerdict(pkg.license);
    if (why === null) continue;
    if (exceptions.some((e) => e.name === pkg.name && e.license === pkg.license)) {
      excepted += 1;
      continue;
    }
    denied.push({ ...pkg, why });
  }
  return { checked: packages.length, denied, excepted };
}

function readReport({ root, input }) {
  if (input !== null) {
    let text;
    try {
      text = readFileSync(input, 'utf8');
    } catch (err) {
      throw new CouldNotCheck(`cannot read ${input}: ${err.message}`);
    }
    return parseJson(text, input);
  }
  // List-form arguments, no shell: nothing here is interpolated into a command.
  const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new CouldNotCheck(`cannot run pnpm: ${result.error.message}`);
  if (result.status !== 0) {
    throw new CouldNotCheck(`\`pnpm licenses list --json\` exited ${result.status}: ${result.stderr.trim()}`);
  }
  return parseJson(result.stdout, '`pnpm licenses list --json`');
}

function parseJson(text, where) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CouldNotCheck(`${where} is not JSON (${err.message})`);
  }
}

function run({ root, input, exceptions }) {
  if (input === null && !existsSync(join(root, 'pnpm-lock.yaml'))) {
    console.log(`check-licenses: no pnpm-lock.yaml in ${root} — nothing to check.`);
    return 0;
  }
  let result;
  try {
    result = checkPackages(packagesFrom(readReport({ root, input })), exceptions);
  } catch (err) {
    if (!(err instanceof CouldNotCheck)) throw err;
    console.error(`check-licenses: ERROR — could not check: ${err.message}`);
    console.error('  A license gate that cannot read the dependency tree has not checked it. Install');
    console.error("  the workspace first ('make install-deps'), then re-run.");
    return 2;
  }

  for (const d of result.denied) {
    const at = d.versions.length ? `@${d.versions.join(',')}` : '';
    console.error(`check-licenses: FAIL  ${d.name}${at}  license "${d.license}" — ${d.why}`);
  }
  console.log(
    `check-licenses: ${result.checked} package(s) checked (every dependency pnpm installed for this ` +
      `platform: production, development and optional), ${result.denied.length} denied, ` +
      `${result.excepted} excepted.`,
  );
  if (result.denied.length === 0) {
    console.log("check-licenses: OK — every dependency's license is compatible with AGPL-3.0-or-later.");
    return 0;
  }
  console.error(
    `check-licenses: FAIL — ${result.denied.length} dependency(ies) carry a license that is not ` +
      'AGPL-3.0-compatible.\n\n' +
      'Replace or remove the dependency. If its license really is compatible (a missing or non-SPDX\n' +
      'license field, verified by hand), add it to EXCEPTIONS in scripts/check-licenses.mjs WITH THE\n' +
      'REASON.',
  );
  return 1;
}

// ─── Self-test ──────────────────────────────────────────────────────────────
//
// Runs this script as a child process against synthetic `pnpm licenses list
// --json` reports and demands the EXACT exit code plus the gate's own verdict
// line (scripts/CLAUDE.md: a self-test must tell a crash from a rejection).

function report(licenses) {
  const groups = {};
  licenses.forEach((license, n) => {
    (groups[license] ??= []).push({
      name: `pkg-${n}`,
      versions: ['1.0.0'],
      paths: [`/fixture/node_modules/pkg-${n}`],
      license,
      homepage: 'https://example.invalid',
    });
  });
  return groups;
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'check-licenses-selftest-'));
  let failures = 0;
  const pass = (msg) => console.log(`SELF-TEST OK: ${msg}`);
  const fail = (msg) => {
    console.error(`SELF-TEST FAILED: ${msg}`);
    failures += 1;
  };

  // <label> <want-exit> <want-substrings[]> <args[]> [env]
  const expectRun = (label, wantExit, wantText, args, env = process.env) => {
    const r = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', env });
    const out = `${r.stdout}${r.stderr}`;
    if (r.status !== wantExit) {
      fail(`${label} — exit ${r.status}, wanted ${wantExit}. Output:\n${out}`);
      return;
    }
    const missing = wantText.filter((t) => !out.includes(t));
    if (missing.length) {
      fail(`${label} — exit ${wantExit} as wanted, but output lacks ${JSON.stringify(missing)}. Output:\n${out}`);
      return;
    }
    pass(label);
  };
  const fixture = (name, content) => {
    const path = join(tmp, name);
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  };

  try {
    const allowed = [
      'MIT', 'mit', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'CC0-1.0',
      'Unlicense', 'BlueOak-1.0.0', 'Python-2.0', 'MPL-2.0', 'LGPL-2.1-or-later', 'LGPL-3.0-only',
      'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'CC-BY-4.0', '(MIT OR Apache-2.0)',
      '(GPL-2.0-only OR MIT)', '(MIT AND ISC)', 'Apache-2.0 WITH LLVM-exception',
    ];
    expectRun('every allowed form passes, OR needs one allowed side', 0,
      [`${allowed.length} package(s) checked`, '0 denied', 'check-licenses: OK'],
      ['--input', fixture('allowed.json', report(allowed))]);

    const denied = [
      'GPL-2.0-only', 'GPL-2.0', 'SSPL-1.0', 'BUSL-1.1', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'Unknown',
      'UNLICENSED', 'SEE LICENSE IN LICENSE.md', '(MIT AND GPL-2.0-only)', 'GPL-2.0-only WITH Classpath-exception-2.0',
      '(MIT OR', 'MIT OR', 'WITH',
    ];
    expectRun('each incompatible, unknown or unparseable license is rejected and named', 1,
      [`${denied.length} denied`, 'check-licenses: FAIL —',
        ...denied.map((_, n) => `pkg-${n}@1.0.0`)],
      ['--input', fixture('denied.json', report(denied))]);

    // One offender among many allowed packages still fails: aggregation must
    // not dilute a single denial.
    expectRun('a lone GPL-2.0-only dependency among allowed ones fails the run', 1,
      ['1 denied', `pkg-${allowed.length}@1.0.0`, 'cannot move to GPL-3.0'],
      ['--input', fixture('lone.json', report([...allowed, 'GPL-2.0-only']))]);

    expectRun('input that is not JSON is "could not check", never a pass', 2,
      ['could not check'], ['--input', fixture('garbage.json', 'No licenses in packages found')]);
    expectRun('JSON of the wrong shape is "could not check"', 2,
      ['could not check'], ['--input', fixture('array.json', [{ name: 'x', license: 'MIT' }])]);

    // The oracle unreachable: a workspace with a lockfile, and no pnpm on PATH.
    const ws = join(tmp, 'workspace');
    mkdirSync(ws);
    writeFileSync(join(ws, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    expectRun('a missing pnpm is "could not check", never a pass', 2,
      ['could not check', 'cannot run pnpm'], ['--root', ws], { ...process.env, PATH: '' });

    const bare = join(tmp, 'no-lockfile');
    mkdirSync(bare);
    expectRun('a tree with no pnpm-lock.yaml is a clean "nothing to check"', 0,
      ['nothing to check'], ['--root', bare], { ...process.env, PATH: '' });

    // EXCEPTIONS, through the same checkPackages the CLI uses.
    const pkgs = [{ name: 'odd-pkg', versions: ['2.0.0'], license: 'SEE LICENSE IN LICENSE' }];
    const waived = checkPackages(pkgs, [{ name: 'odd-pkg', license: 'SEE LICENSE IN LICENSE', reason: 'verified MIT by hand' }]);
    if (waived.denied.length === 0 && waived.excepted === 1) pass('an exception with a reason waives exactly its package');
    else fail(`exception with a reason did not waive odd-pkg: ${JSON.stringify(waived)}`);
    const otherLicense = checkPackages(pkgs, [{ name: 'odd-pkg', license: 'Unknown', reason: 'verified' }]);
    if (otherLicense.denied.length === 1) pass('an exception for a different license string does not apply');
    else fail('an exception matched a package whose license string differs');
    try {
      checkPackages(pkgs, [{ name: 'odd-pkg', license: 'SEE LICENSE IN LICENSE', reason: ' ' }]);
      fail('an exception with no reason was accepted');
    } catch (err) {
      if (err instanceof CouldNotCheck) pass('an exception with no reason is refused');
      else throw err;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`check-licenses: self-test FAILED (${failures} case(s)).`);
    return 1;
  }
  console.log('check-licenses: self-test passed.');
  return 0;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main(argv) {
  const opts = { root: REPO_ROOT, input: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') opts.selfTest = true;
    else if (a === '--root' && argv[i + 1] !== undefined) opts.root = argv[++i];
    else if (a === '--input' && argv[i + 1] !== undefined) opts.input = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/check-licenses.mjs [--root <dir>] [--input <licenses.json>] [--self-test]');
      return 0;
    } else {
      console.error(`check-licenses: unknown or incomplete argument: ${a}`);
      return 2;
    }
  }
  if (opts.selfTest) return selfTest();
  return run({ ...opts, exceptions: EXCEPTIONS });
}

process.exitCode = main(process.argv.slice(2));
