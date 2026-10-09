import { afterEach, describe, expect, it, vi } from "vitest";

import { saveFile } from "./saveFile";

describe("saveFile", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the text under its name from a local URL, then lets the URL go", () => {
    vi.useFakeTimers();
    const link = { href: "", download: "", rel: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => link) });
    const created = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:local/1");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();

    saveFile("Doh_KDVP_2026.xml", "<Envelope/>");

    const blob = created.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/xml;charset=utf-8");
    expect(link).toMatchObject({
      href: "blob:local/1",
      download: "Doh_KDVP_2026.xml",
      rel: "noopener",
    });
    expect(link.click).toHaveBeenCalledOnce();
    // Not before the click was handled: that would cancel the save.
    expect(revoked).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoked).toHaveBeenCalledWith("blob:local/1");
  });
});
