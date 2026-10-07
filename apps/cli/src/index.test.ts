import { afterEach, describe, expect, it, vi } from "vitest";

import manifest from "../package.json" with { type: "json" };
import { main } from "./index.js";

describe("@taxreporter/cli", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("prints its name and package.json version, and says it is not yet functional", () => {
    let printed = "";
    const code = main({
      write: (chunk) => {
        printed += chunk;
      },
    });

    expect(code).toBe(0);
    expect(printed).toContain(
      `taxreporter ${manifest.version} (${manifest.name})`,
    );
    expect(printed).toContain("not yet functional");
  });

  it("wires the bin entry to main, stdout and the process exit code", async () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await import("./bin.js");

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("not yet functional"),
    );
    expect(process.exitCode).toBe(0);
  });
});
