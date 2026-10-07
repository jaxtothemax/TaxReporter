/**
 * @taxreporter/cli — the `taxreporter` command. Skeleton only: it identifies
 * itself and says it cannot do anything yet. The process entry is ./bin.ts.
 */
import { readFileSync } from "node:fs";

/** Where `main` writes: process.stdout in the bin, a buffer in tests. */
export interface Output {
  write(chunk: string): unknown;
}

interface Manifest {
  readonly name: string;
  readonly version: string;
}

function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string"
  );
}

/**
 * This package's own package.json. Read at run time, not copied into the
 * source, so the version printed is always the one scripts/release.sh bumped;
 * `../package.json` resolves the same from src/ (tests) and dist/ (the bin).
 */
function readManifest(): Manifest {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (!isManifest(manifest)) {
    throw new Error(
      "@taxreporter/cli: package.json has no string name and version",
    );
  }
  return manifest;
}

/** Runs the CLI and returns its exit code. */
export function main(out: Output = process.stdout): number {
  const { name, version } = readManifest();
  out.write(`taxreporter ${version} (${name})\n`);
  out.write(
    "TaxReporter is pre-alpha and not yet functional: it cannot read broker exports or write eDavki XML yet.\n",
  );
  return 0;
}
