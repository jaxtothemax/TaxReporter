import { describe, expect, it } from "vitest";

import manifest from "../package.json" with { type: "json" };
import * as pipeline from "./index.js";

describe("@taxreporter/pipeline", () => {
  it("identifies itself by the name its package.json publishes", () => {
    expect(pipeline.PACKAGE).toBe(manifest.name);
  });

  it("exports the one run from exports to returns, and its halves", () => {
    for (const name of [
      "prepareReturns",
      "readExports",
      "buildReturns",
      "coverageOf",
    ] as const) {
      expect(typeof pipeline[name], name).toBe("function");
    }
  });
});
