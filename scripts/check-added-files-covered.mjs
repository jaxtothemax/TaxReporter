#!/usr/bin/env node
// scripts/check-added-files-covered.mjs — a brand-new source file with zero
// tests never appears in the coverage report at all, so diff-coverage tools
// score it as 100% covered instead of 0%.
//
// ## Why this exists
//
// diff-cover (and any line-diff coverage tool) only scores rows it finds in
// the coverage report. A file with no rows contributes nothing to the
// denominator, so it reads as fully covered instead of entirely untested —
// backwards from what a reviewer would want: a file with *some* tests gets
// scrutinized, a file with *none* sails through silently. This is the
// per-file sibling of "an uninstrumented CI job reads as 0% in the
// aggregate" — same root cause, unmeasured code being scored as if it were
// fine.
//
// ## What this checks
//
// Every file *added* (not modified) on this branch since it diverged from
// the target branch, filtered by one or more configurable "coverage
// layers" (a directory prefix + a set of extensions that layer's coverage
// report covers), must appear as a `<class filename="...">` row in that
// layer's Cobertura XML report. A source file that isn't there was never
// executed by the test suite at all.
//
// ## Configurable layers — the "source file" definition
//
// A layer is
// `<dirPrefix>:<ext1,ext2,...>:<coverageReportPath>[:<omitConfigPath>:<omitFormat>[:<reportRoot>]]`,
// passed via one or more `--layer` flags. `dirPrefix` selects which added
// files belong to this layer (e.g. "frontend/src/" — application source
// only); `reportRoot` (default: same as `dirPrefix`) is the root the
// coverage report and the omit config express paths relative to (e.g.
// "frontend/" — a test runner's own working directory, which is usually
// broader than the source subdirectory it type-checks). `omitFormat` is
// `coveragerc` (Python `coverage.py`'s `[run] omit = ` fnmatch list) or
// `vitest` (a `test.coverage.exclude: [...]` glob array) — the two formats
// read here so this script cannot drift from a project's own exclusion
// config. Omit the omitConfigPath/omitFormat fields for no config-driven
// exclusions at all.
//
// With no `--layer` given, two defaults apply — a Python backend under
// `backend/` (using `backend/.coveragerc`) and a TypeScript frontend under
// `frontend/src/` (using `frontend/vitest.config.ts`). Both are inert no-ops
// in a clone that has neither directory: zero added files match the prefix,
// so the layer contributes zero candidates and zero violations. This is the
// "skip cleanly when the stack is absent" behavior for the directory side of
// things.
//
// A missing COVERAGE REPORT is treated the same way, deliberately: if a
// layer's report file does not exist, that layer is skipped with an INFO
// line rather than failing. The report is produced by a stack's own test
// job (`python-test` / `node-test` in `ci/`), which a clone may not have
// wired up yet, or a local developer may not have run — a hard failure
// there would be indistinguishable from "the tooling for this stack was
// never configured" and would nag every clone that has not run coverage
// locally. The gate's value is comparing an EXISTING report against the
// diff; it is not a substitute for "did you remember to run coverage".
//
// ## Usage
//
//   node scripts/check-added-files-covered.mjs [options]
//
//   --target-ref <ref>        Git ref to diff against (default:
//                              origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
//                              or origin/main outside CI).
//   --no-fetch                 Skip `git fetch` of the target branch (assumes
//                              it is already up to date locally).
//   --layer <spec>              Repeatable. See "Configurable layers" above.
//                              Defaults to the two built-in layers if none given.
//   --self-test                 Build a synthetic git repo in a temp
//                              directory, prove the check fires on known-bad
//                              input and stays clean on known-good input,
//                              then exit. Touches no real repository state.
//   -h, --help                  Print this message.
//
// Exit codes: 0 = every added source file (in a layer whose report exists)
// is covered, or nothing to check; 1 = at least one added source file is
// absent from its layer's coverage report entirely, or a self-test
// assertion failed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

// ─── git helpers ──────────────────────────────────────────────────────────

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    return { ok: false, stdout: '', stderr: result.stderr || result.error?.message || 'git failed' };
  }
  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

function getAddedFiles(cwd, targetRef) {
  const base = git(['merge-base', targetRef, 'HEAD'], cwd);
  if (!base.ok || !base.stdout.trim()) {
    return { base: null, files: [] };
  }
  const baseSha = base.stdout.trim();
  const diff = git(['diff', '--diff-filter=A', '--name-only', baseSha, 'HEAD'], cwd);
  if (!diff.ok) {
    throw new Error(`git diff failed: ${diff.stderr}`);
  }
  const files = diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return { base: baseSha, files };
}

// ─── pattern matching ─────────────────────────────────────────────────────

// Python fnmatch semantics (used by coverage.py's `omit`): `*` matches any
// run of characters, including `/` — there is no path-segment boundary.
function fnmatchToRegex(pattern) {
  let re = '';
  for (const c of pattern) {
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if ('.\\+^$()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

// minimatch-lite semantics (used by vitest's `coverage.exclude`): `**`
// crosses `/`, a single `*` stops at `/`.
function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.\\+^$()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesAny(relPath, regexes) {
  return regexes.some((re) => re.test(relPath));
}

// ─── config readers ───────────────────────────────────────────────────────

function readCoveragercOmit(coveragercPath) {
  if (!existsSync(coveragercPath)) return [];
  const text = readFileSync(coveragercPath, 'utf8');
  const lines = text.split('\n');
  const patterns = [];
  let inOmit = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^\s*omit\s*=/.test(line)) {
      inOmit = true;
      const inline = line.replace(/^\s*omit\s*=\s*/, '').trim();
      if (inline) patterns.push(inline);
      continue;
    }
    if (inOmit) {
      if (/^\s+\S/.test(line)) {
        patterns.push(line.trim());
      } else if (line.trim() === '') {
        continue;
      } else {
        inOmit = false;
      }
    }
  }
  return patterns.filter(Boolean).map(fnmatchToRegex);
}

function readVitestExclude(vitestConfigPath) {
  if (!existsSync(vitestConfigPath)) return [];
  const text = readFileSync(vitestConfigPath, 'utf8');
  const match = text.match(/exclude\s*:\s*\[([^\]]*)\]/);
  if (!match) return [];
  const items = [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  return items.map(globToRegex);
}

function readOmitRegexes(cwd, omitConfigPath, omitFormat) {
  if (!omitConfigPath || !omitFormat || omitFormat === 'none') return [];
  const abs = resolve(cwd, omitConfigPath);
  if (omitFormat === 'coveragerc') return readCoveragercOmit(abs);
  if (omitFormat === 'vitest') return readVitestExclude(abs);
  throw new Error(`unknown --layer omitFormat "${omitFormat}" (expected "coveragerc" or "vitest")`);
}

// ─── Cobertura XML ────────────────────────────────────────────────────────

// Extracts every <class filename="..."> value. A file that coverage never
// imported/executed has no <class> row at all — that absence is exactly the
// signal this script exists to catch, so we don't need a full XML parser,
// just the filename attributes.
function parseCoberturaFilenames(xmlPath) {
  if (!existsSync(xmlPath)) return null;
  const text = readFileSync(xmlPath, 'utf8');
  const filenames = new Set();
  for (const m of text.matchAll(/<class\b[^>]*\bfilename="([^"]+)"/g)) {
    filenames.add(m[1].replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  return filenames;
}

// Normalizes a Cobertura `filename` against a known layer-relative prefix:
// if the report's path literally contains that prefix as a path segment
// (e.g. a runner wrote an absolute build path), strip everything up to and
// including it so it compares like our repo-root-relative candidate. This is
// intentionally narrower than a generic suffix match — an open-ended
// `endsWith('/' + shortPath)` false-matches two unrelated files that happen
// to share a generic tail (two apps each with a `commands/utils.py`), which
// would silently mark a genuinely uncovered new file as covered.
function normalizeCovPath(cov, prefix) {
  const idx = cov.indexOf(prefix);
  if (idx === -1) return cov;
  if (idx !== 0 && cov[idx - 1] !== '/') return cov;
  return cov.slice(idx + prefix.length);
}

function isFileCovered(relPath, prefix, coberturaFilenames) {
  const stripped = relPath.startsWith(prefix) ? relPath.slice(prefix.length) : relPath;
  for (const cov of coberturaFilenames) {
    if (cov === stripped || cov === relPath) return true;
    if (normalizeCovPath(cov, prefix) === stripped) return true;
  }
  return false;
}

// ─── layer configuration ──────────────────────────────────────────────────

const DEFAULT_LAYERS = [
  'backend/:py:backend/coverage.xml:backend/.coveragerc:coveragerc',
  'frontend/src/:ts,tsx:frontend/coverage/cobertura-coverage.xml:frontend/vitest.config.ts:vitest:frontend/',
];

// `reportRoot` is separate from `dirPrefix` because the two can legitimately
// differ: files are SELECTED by `dirPrefix` (e.g. "frontend/src/" — only
// application source, not config/build files), but the coverage report and
// the exclusion config both express paths relative to the STACK root (e.g.
// "frontend/" — vitest's own working directory), not the narrower source
// subdirectory. Defaulting `reportRoot` to `dirPrefix` keeps single-prefix
// layers (the backend default, where both are "backend/") a 3-4 field spec.
function parseLayerSpec(spec) {
  const parts = spec.split(':');
  if (parts.length < 3) {
    throw new Error(
      `invalid --layer "${spec}" (expected dirPrefix:ext1,ext2:coveragePath[:omitConfigPath:omitFormat[:reportRoot]])`,
    );
  }
  const [dirPrefix, extsRaw, coveragePath, omitConfigPath, omitFormat, reportRoot] = parts;
  const exts = extsRaw.split(',').map((e) => e.trim()).filter(Boolean).map((e) => (e.startsWith('.') ? e : '.' + e));
  return {
    dirPrefix,
    exts,
    coveragePath,
    omitConfigPath: omitConfigPath || null,
    omitFormat: omitFormat || null,
    reportRoot: reportRoot || dirPrefix,
  };
}

// ─── candidate filtering ──────────────────────────────────────────────────

const MIGRATIONS_RE = /(^|\/)migrations\/.*\.py$/;

function classifyCandidates(files, layer, omitRegexes) {
  const out = [];
  for (const f of files) {
    if (!f.startsWith(layer.dirPrefix)) continue;
    if (!layer.exts.some((ext) => f.endsWith(ext))) continue;
    // Relative to reportRoot (the stack root), not dirPrefix (the narrower
    // source scope) — omit patterns are written relative to the former.
    const rel = f.startsWith(layer.reportRoot) ? f.slice(layer.reportRoot.length) : f;
    if (rel === 'manage.py') continue;
    if (MIGRATIONS_RE.test(rel)) continue;
    if (matchesAny(rel, omitRegexes)) continue;
    out.push(f);
  }
  return out;
}

// ─── core check ───────────────────────────────────────────────────────────

function runCheck({ cwd, targetRef, layers }) {
  const { base, files } = getAddedFiles(cwd, targetRef);
  if (base === null) {
    return { ok: true, violations: [], infos: [`could not determine merge base with ${targetRef}; skipping.`] };
  }

  const violations = [];
  const infos = [];

  for (const layerSpec of layers) {
    const layer = parseLayerSpec(layerSpec);
    const omitRegexes = readOmitRegexes(cwd, layer.omitConfigPath, layer.omitFormat);
    const candidates = classifyCandidates(files, layer, omitRegexes);
    if (candidates.length === 0) continue;

    const covPath = resolve(cwd, layer.coveragePath);
    const filenames = parseCoberturaFilenames(covPath);
    if (filenames === null) {
      infos.push(
        `layer "${layer.dirPrefix}" has ${candidates.length} added source file(s) but no coverage ` +
          `report at ${layer.coveragePath} — skipping (stack/tooling not configured in this clone, ` +
          'or the coverage job has not run yet).',
      );
      continue;
    }

    for (const f of candidates) {
      if (!isFileCovered(f, layer.reportRoot, filenames)) {
        violations.push({
          file: f,
          message:
            `new file has no coverage data at all: ${f}. It does not appear in ${layer.coveragePath}, ` +
            'meaning the test suite never imported or executed it — diff-cover finds no rows for it ' +
            'and reports it as 100% covered, which is exactly backwards. Add a test that exercises ' +
            'this file, or if it is intentionally untested (e.g. a generated or vendored file), add ' +
            'it to the layer\'s omit/exclude config so it is excluded consistently everywhere, not ' +
            'silently skipped here.',
        });
      }
    }
  }

  return { ok: violations.length === 0, violations, infos };
}

// ─── self-test ────────────────────────────────────────────────────────────

const COVERAGERC_FIXTURE = `[run]
source = .
relative_files = true
omit =
    */tests/*
    */management/commands/benchmark.py

[report]
skip_covered = true
`;

const VITEST_CONFIG_FIXTURE = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'cobertura'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.*', 'src/**/*.spec.*', 'src/vite-env.d.ts'],
    },
  },
})
`;

function coberturaXml(classes) {
  const classRows = classes
    .map((f) => `        <class name="${f}" filename="${f}" line-rate="1"><lines/></class>`)
    .join('\n');
  return `<?xml version="1.0" ?>
<coverage line-rate="1">
  <packages>
    <package name="root">
      <classes>
${classRows}
      </classes>
    </package>
  </packages>
</coverage>
`;
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function assert(condition, message, failures) {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    console.error(`  SELF-TEST FAILED — ${message}`);
    failures.push(message);
  }
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'check-added-files-covered-selftest-'));
  const failures = [];
  try {
    console.log(`=== self-test: building synthetic repo in ${tmp} ===`);

    const run = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    };

    run(['init', '--quiet', '-b', 'main']);
    run(['config', 'user.email', 'self-test@example.com']);
    run(['config', 'user.name', 'self-test']);

    writeFile(join(tmp, 'backend', '.coveragerc'), COVERAGERC_FIXTURE);
    writeFile(join(tmp, 'frontend', 'vitest.config.ts'), VITEST_CONFIG_FIXTURE);
    writeFile(join(tmp, 'backend', 'testapp', '__init__.py'), '');
    run(['add', '-A']);
    run(['commit', '--quiet', '-m', 'initial']);

    run(['checkout', '--quiet', '-b', 'feature']);

    writeFile(join(tmp, 'backend', 'testapp', 'covered.py'), 'def ok():\n    return 1\n');
    writeFile(join(tmp, 'backend', 'testapp', 'uncovered.py'), 'def bad():\n    return 1\n');
    writeFile(join(tmp, 'backend', 'testapp', 'tests', 'test_covered.py'), '# test\n');
    writeFile(join(tmp, 'backend', 'testapp', 'migrations', '0002_add_field.py'), '# migration\n');
    // Generic-basename collision guard: a genuinely uncovered new top-level
    // module ("utils.py") whose bare filename matches the *tail* of an
    // unrelated, already-covered file nested in a different app.
    writeFile(join(tmp, 'backend', 'utils.py'), 'def new_util():\n    pass\n');

    writeFile(join(tmp, 'frontend', 'src', 'components', 'Covered.tsx'), 'export const Covered = () => null;\n');
    writeFile(join(tmp, 'frontend', 'src', 'components', 'Uncovered.tsx'), 'export const Uncovered = () => null;\n');
    writeFile(join(tmp, 'frontend', 'src', 'test', 'helper.ts'), 'export const helper = () => {};\n');

    run(['add', '-A']);
    run(['commit', '--quiet', '-m', 'feature: add covered, uncovered, test, and migration files']);

    writeFile(
      join(tmp, 'backend', 'coverage.xml'),
      coberturaXml(['testapp/covered.py', 'legacyapp/utils.py']),
    );
    writeFile(join(tmp, 'frontend', 'coverage', 'cobertura-coverage.xml'), coberturaXml(['src/components/Covered.tsx']));

    console.log('--- Case: known-bad fixture (uncovered.py / Uncovered.tsx present, no coverage rows) ---');
    const result = runCheck({ cwd: tmp, targetRef: 'main', layers: DEFAULT_LAYERS });

    assert(!result.ok, 'detection fires on the known-bad fixture (result.ok === false)', failures);
    const flagged = result.violations.map((v) => v.file);
    assert(flagged.includes('backend/testapp/uncovered.py'), 'flags backend/testapp/uncovered.py', failures);
    assert(flagged.includes('frontend/src/components/Uncovered.tsx'), 'flags frontend/src/components/Uncovered.tsx', failures);
    assert(!flagged.includes('backend/testapp/covered.py'), 'does not flag backend/testapp/covered.py', failures);
    assert(!flagged.includes('frontend/src/components/Covered.tsx'), 'does not flag frontend/src/components/Covered.tsx', failures);
    assert(!flagged.includes('backend/testapp/tests/test_covered.py'), 'does not flag a test file (omitted via */tests/*)', failures);
    assert(!flagged.includes('backend/testapp/migrations/0002_add_field.py'), 'does not flag a migration file', failures);
    assert(!flagged.includes('frontend/src/test/helper.ts'), 'does not flag a file excluded via src/test/**', failures);
    assert(
      flagged.includes('backend/utils.py'),
      'flags a genuinely uncovered top-level file even when an unrelated covered file shares its ' +
        'bare filename (legacyapp/utils.py) — generic-basename collision guard',
      failures,
    );

    console.log('--- Case: clean fixture (uncovered files removed) ---');
    writeFileSync(
      join(tmp, 'backend', 'coverage.xml'),
      coberturaXml(['testapp/covered.py', 'testapp/uncovered.py', 'utils.py', 'legacyapp/utils.py']),
    );
    writeFileSync(
      join(tmp, 'frontend', 'coverage', 'cobertura-coverage.xml'),
      coberturaXml(['src/components/Covered.tsx', 'src/components/Uncovered.tsx']),
    );
    const cleanResult = runCheck({ cwd: tmp, targetRef: 'main', layers: DEFAULT_LAYERS });
    assert(cleanResult.ok, 'passes once every added source file has a coverage row', failures);

    console.log('--- Case: layer whose coverage report is entirely absent skips cleanly ---');
    const noReportResult = runCheck({
      cwd: tmp,
      targetRef: 'main',
      layers: ['backend/:py:backend/does-not-exist.xml'],
    });
    assert(noReportResult.ok, 'a missing coverage report is a skip, not a violation', failures);
    assert(
      noReportResult.infos.some((i) => i.includes('does-not-exist.xml')),
      'the skip is explained in an info line, not silent',
      failures,
    );

    console.log('--- Case: stack absent entirely (no matching directory) reports zero candidates ---');
    const absentStackResult = runCheck({
      cwd: tmp,
      targetRef: 'main',
      layers: ['mobile/:swift:mobile/coverage.xml'],
    });
    assert(absentStackResult.ok, 'a layer whose directory has no added files is a silent no-op', failures);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n=== self-test: FAILED (${failures.length} assertion(s)) ===`);
    process.exit(1);
  }
  console.log('\n=== self-test: PASSED ===');
  process.exit(0);
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    targetRef: null,
    noFetch: false,
    layers: [],
    selfTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target-ref') opts.targetRef = argv[++i];
    else if (a === '--no-fetch') opts.noFetch = true;
    else if (a === '--layer') opts.layers.push(argv[++i]);
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (opts.layers.length === 0) opts.layers = DEFAULT_LAYERS;
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(
      'Usage: node scripts/check-added-files-covered.mjs [--target-ref <ref>] [--no-fetch] ' +
        '[--layer <dirPrefix>:<exts>:<coveragePath>[:<omitConfigPath>:<omitFormat>]] [--self-test]',
    );
    process.exit(0);
  }

  if (opts.selfTest) {
    selfTest();
    return;
  }

  const cwd = process.cwd();
  let targetRef = opts.targetRef;
  if (!targetRef) {
    const branch = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || 'main';
    targetRef = `origin/${branch}`;
    if (!opts.noFetch) {
      const fetch = spawnSync('git', ['fetch', 'origin', branch, '--depth=100'], { cwd, stdio: 'inherit' });
      if (fetch.status !== 0) {
        console.error(`ERROR — git fetch origin ${branch} failed.`);
        process.exit(1);
      }
    }
  }

  const result = runCheck({ cwd, targetRef, layers: opts.layers });

  for (const info of result.infos) {
    console.log(`INFO — ${info}`);
  }

  if (result.ok) {
    console.log('OK — every added source file (in a layer with a coverage report) appears in it.');
    process.exit(0);
  }

  console.error(`ERROR — ${result.violations.length} added file(s) are absent from their coverage report entirely:\n`);
  for (const v of result.violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.message}\n`);
  }
  process.exit(1);
}

main();
