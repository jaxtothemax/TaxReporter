/**
 * The one place the tests validate XML against a vendored FURS schema.
 *
 * It uses libxml2's xmllint compiled to WebAssembly (xmllint-wasm, pinned
 * exactly), so every OS and CI runner validates the same way: GitHub's
 * Ubuntu runner has no xmllint, and system versions differ. The package does
 * no I/O of its own. It gets exactly one main schema, with EDP-Common-1.xsd
 * (which every form schema imports by relative schemaLocation) preloaded
 * under its own name, as the vendored bytes, BOM and CRLF included.
 *
 * Its embedded libxml2 is 2.13.8, an end-of-life branch that `pnpm audit` and
 * osv-scan cannot see (ADR 0007). Revisit before any use outside the tests.
 *
 * Lives in test/, which the build excludes, so it never reaches dist.
 */
import { readFileSync } from "node:fs";

import { validateXML } from "xmllint-wasm";

const SCHEMAS = new URL("../schemas/", import.meta.url);

const read = (file: string) => readFileSync(new URL(file, SCHEMAS));

export type FormSchema = "Doh_KDVP_9.xsd" | "Doh_Div_3.xsd";

export interface SchemaResult {
  readonly valid: boolean;
  /** xmllint's messages, empty when valid. */
  readonly errors: readonly string[];
}

/**
 * Validates `xml` against one form schema. A validator that crashes rejects
 * the promise, which fails the test like an invalid document does.
 */
export async function validateAgainstSchema(
  xml: string,
  schema: FormSchema,
): Promise<SchemaResult> {
  const result = await validateXML({
    xml: [{ fileName: "document.xml", contents: xml }],
    // Exactly one schema: with several, xmllint-wasm takes the last as the
    // main one, whatever its documentation says.
    schema: [{ fileName: schema, contents: read(schema) }],
    preload: [
      { fileName: "EDP-Common-1.xsd", contents: read("EDP-Common-1.xsd") },
    ],
  });
  return {
    valid: result.valid,
    errors: result.valid
      ? []
      : [result.rawOutput, ...result.errors.map((e) => e.rawMessage)],
  };
}
