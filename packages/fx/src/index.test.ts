import { describe, expect, it } from "vitest";

import manifest from "../package.json" with { type: "json" };
import { PACKAGE } from "./index.js";

describe("@taxreporter/fx", () => {
  it("identifies itself by the name its package.json publishes", () => {
    expect(PACKAGE).toBe(manifest.name);
  });
});
