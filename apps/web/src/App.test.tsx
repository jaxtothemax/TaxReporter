import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("says the app is pre-alpha and that processing will stay in the browser", () => {
    expect(renderToStaticMarkup(<App />)).toContain(
      "TaxReporter — pre-alpha, not usable yet; all processing will happen in your browser",
    );
  });
});
