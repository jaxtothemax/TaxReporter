import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The tests run in Node, with no DOM: stub the two things index.ts touches.
vi.mock("react-dom/client", () => ({ createRoot: vi.fn() }));

function stubDocument(root: object | null): void {
  vi.stubGlobal("document", {
    getElementById: (id: string) => (id === "root" ? root : null),
  });
}

describe("index.ts (browser entry)", () => {
  // index.ts mounts as an import side effect, so each case needs a fresh copy.
  beforeEach(() => {
    vi.resetModules();
  });

  it("mounts <App /> inside StrictMode into #root", async () => {
    const container = {};
    const render = vi.fn<(children: ReactNode) => void>();
    vi.mocked(createRoot).mockReturnValue({ render } as unknown as Root);
    stubDocument(container);

    await import("./index");
    // From the same (reset) module registry index.ts just imported it from.
    const { App } = await import("./App");

    expect(createRoot).toHaveBeenCalledWith(container);
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      type: StrictMode,
      props: { children: { type: App } },
    });
  });

  it("fails loudly when index.html has no #root", async () => {
    stubDocument(null);

    await expect(import("./index")).rejects.toThrow('no <div id="root">');
  });
});
