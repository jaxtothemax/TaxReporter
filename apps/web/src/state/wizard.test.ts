import { describe, expect, it } from "vitest";

import {
  blockingReason,
  canEnter,
  initialWizardState,
  isValidTaxNumber,
  normalizeTaxNumber,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "./wizard";

function run(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

describe("tax number", () => {
  it("accepts exactly eight digits, with spaces allowed while typing", () => {
    expect(isValidTaxNumber("12345678")).toBe(true);
    expect(isValidTaxNumber("1234 5678")).toBe(true);
    expect(normalizeTaxNumber(" 1234 5678 ")).toBe("12345678");
  });

  it("rejects anything else", () => {
    for (const bad of ["", "1234567", "123456789", "1234567a", "SI12345678"]) {
      expect(isValidTaxNumber(bad), bad).toBe(false);
    }
  });
});

describe("demo mode", () => {
  it("starts on the files step with the two demo exports loaded", () => {
    const state = run({ type: "startDemo" });
    expect(state.screen).toBe("files");
    expect(state.mode).toBe("demo");
    expect(state.files.map((f) => f.kind)).toEqual(["demo", "demo"]);
  });

  it("walks to the download without personal data", () => {
    const state = run(
      { type: "startDemo" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
    );
    expect(state.screen).toBe("download");
    expect(state.details.taxNumber).toBe("");
  });

  it("lets the stepper jump to any step", () => {
    const state = run(
      { type: "startDemo" },
      { type: "goTo", screen: "download" },
    );
    expect(state.screen).toBe("download");
  });
});

describe("own files", () => {
  it("will not leave the files step without a file, and says why", () => {
    const state = run({ type: "startOwn" }, { type: "next" });
    expect(state.screen).toBe("files");
    expect(state.showErrors).toBe(true);
    expect(blockingReason(state, "files")).toBe("needFiles");
  });

  it("records added files by name and size, with unique ids", () => {
    const state = run(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "a.csv", size: 10 }] },
      { type: "addFiles", files: [{ name: "b.xml", size: 20 }] },
    );
    expect(state.files).toEqual([
      { kind: "own", id: "file-1", name: "a.csv", size: 10, supported: true },
      { kind: "own", id: "file-2", name: "b.xml", size: 20, supported: true },
    ]);
  });

  it("ignores an empty selection", () => {
    const before = run({ type: "startOwn" });
    expect(wizardReducer(before, { type: "addFiles", files: [] })).toBe(before);
  });

  it("removes a file by id", () => {
    const state = run(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [
          { name: "a.csv", size: 10 },
          { name: "b.csv", size: 5 },
        ],
      },
      { type: "removeFile", id: "file-1" },
    );
    expect(state.files.map((f) => f.name)).toEqual(["b.csv"]);
  });

  it("requires a valid tax number before the review", () => {
    const atDetails = run(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "a.csv", size: 10 }] },
      { type: "next" },
    );
    expect(atDetails.screen).toBe("details");
    expect(canEnter(atDetails, "review")).toBe(false);

    const blocked = wizardReducer(atDetails, { type: "next" });
    expect(blocked.screen).toBe("details");
    expect(blocked.showErrors).toBe(true);

    const fixed = wizardReducer(blocked, {
      type: "setDetail",
      field: "taxNumber",
      value: "1234 5678",
    });
    const moved = wizardReducer(fixed, { type: "next" });
    expect(moved.screen).toBe("review");
    expect(moved.showErrors).toBe(false);
  });

  it("keeps the download out of reach while own files cannot be read", () => {
    const state = run(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "a.csv", size: 1 }] },
      { type: "setDetail", field: "taxNumber", value: "12345678" },
    );
    expect(canEnter(state, "review")).toBe(true);
    expect(canEnter(state, "download")).toBe(false);
    expect(blockingReason(state, "review")).toBe("noResults");
  });

  it("blocks the files step while an unsupported file is listed", () => {
    const state = run(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [
          { name: "a.csv", size: 1 },
          { name: "b.xlsx", size: 1 },
        ],
      },
    );
    expect(state.files.map((f) => f.kind === "own" && f.supported)).toEqual([
      true,
      false,
    ]);
    expect(blockingReason(state, "files")).toBe("unsupportedFile");
    const fixed = wizardReducer(state, { type: "removeFile", id: "file-2" });
    expect(blockingReason(fixed, "files")).toBeNull();
  });

  it("refuses to jump past a step that still blocks", () => {
    const state = run({ type: "startOwn" }, { type: "goTo", screen: "review" });
    expect(state.screen).toBe("files");
  });

  it("swaps unread own files for the demo files when asked", () => {
    const state = run(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "a.csv", size: 10 }] },
      { type: "useDemoFiles" },
    );
    expect(state.mode).toBe("demo");
    expect(state.files.every((f) => f.kind === "demo")).toBe(true);
  });

  it("adding own files after the demo leaves demo mode and drops the demo files", () => {
    const state = run(
      { type: "startDemo" },
      { type: "addFiles", files: [{ name: "x.csv", size: 1 }] },
    );
    expect(state.mode).toBe("own");
    expect(state.files.map((f) => f.kind)).toEqual(["own"]);
  });
});

describe("navigation", () => {
  it("goes back step by step, and from the files step to the start", () => {
    const state = run(
      { type: "startDemo" },
      { type: "next" },
      { type: "back" },
      { type: "back" },
    );
    expect(state.screen).toBe("start");
  });

  it("restarts to a clean state", () => {
    const state = run(
      { type: "startOwn" },
      { type: "setDetail", field: "name", value: "Maja Kovač" },
      { type: "restart" },
    );
    expect(state).toEqual(initialWizardState);
  });

  it("the start screen is always reachable", () => {
    expect(canEnter(initialWizardState, "start")).toBe(true);
    expect(wizardReducer(initialWizardState, { type: "next" }).screen).toBe(
      "files",
    );
  });
});
