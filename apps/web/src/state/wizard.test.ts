import { describe, expect, it } from "vitest";

import type {
  FileSummary,
  FormOutput,
  PrepareReply,
  ReadReply,
} from "../engine/protocol";
import { demoPreview } from "../demo/demoPreview";
import {
  asksAccounts,
  blockingReason,
  canEnter,
  initialWizardState,
  isPayerIncomplete,
  isValidTaxNumber,
  labelsOf,
  normalizeTaxNumber,
  payerDetails,
  summaryOf,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "./wizard";

function run(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

const file = (id: string, name = `${id}.csv`, size = 10) => ({
  id,
  name,
  size,
});

const summary = (overrides: Partial<FileSummary> = {}): FileSummary => ({
  status: "read",
  broker: "trading212",
  firstDate: "2026-01-05",
  lastDate: "2026-09-10",
  rows: 9,
  sameAs: null,
  unnamedAccount: true,
  findings: [],
  ...overrides,
});

const readReply = (
  files: readonly FileSummary[],
  overrides: Partial<ReadReply> = {},
): ReadReply => ({
  v: 1,
  id: 1,
  kind: "read",
  files,
  findings: [],
  payers: [
    {
      isin: "US1912161007",
      symbol: "KO",
      name: "Coca-Cola",
      isinCountry: "US",
      payments: 2,
    },
  ],
  symbols: { US1912161007: "KO" },
  ...overrides,
});

const form = (overrides: Partial<FormOutput> = {}): FormOutput => ({
  xml: "<x/>",
  blocking: 0,
  needed: true,
  ...overrides,
});

const prepareReply = (kdvp: FormOutput, div: FormOutput): PrepareReply => ({
  v: 1,
  id: 2,
  kind: "prepare",
  files: [],
  preview: demoPreview,
  kdvp,
  div,
});

/** Own files added and read by request 1, the details step ahead. */
function readOwn(
  files: readonly FileSummary[] = [summary()],
  overrides: Partial<ReadReply> = {},
): WizardState {
  const ids = files.map((_, i) => `file-${String(i + 1)}`);
  return run(
    { type: "startOwn" },
    { type: "addFiles", files: ids.map((id) => file(id)) },
    { type: "readStarted", request: 1, fileIds: ids },
    {
      type: "readDone",
      request: 1,
      reply: readReply(files, overrides),
    },
  );
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

  it("records added files under the ids the app gave them", () => {
    const state = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1", "a.csv", 10)] },
      { type: "addFiles", files: [file("file-2", "b.xml", 20)] },
    );
    expect(state.files).toEqual([
      { kind: "own", id: "file-1", name: "a.csv", size: 10, supported: true },
      { kind: "own", id: "file-2", name: "b.xml", size: 20, supported: true },
    ]);
  });

  it("ignores an empty selection, and a removal of a file not listed", () => {
    const before = run({ type: "startOwn" });
    expect(wizardReducer(before, { type: "addFiles", files: [] })).toBe(before);
    expect(wizardReducer(before, { type: "removeFile", id: "x" })).toBe(before);
  });

  it("removes a file by id, and reads the rest again", () => {
    const read = readOwn([summary(), summary()]);
    const state = wizardReducer(read, { type: "removeFile", id: "file-1" });
    expect(state.files.map((f) => f.id)).toEqual(["file-2"]);
    expect(state.reading).toEqual({ status: "idle" });
  });

  it("waits for the reading before it leaves the files step", () => {
    const added = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
    );
    expect(blockingReason(added, "files")).toBe("stillReading");
    const reading = wizardReducer(added, {
      type: "readStarted",
      request: 1,
      fileIds: ["file-1"],
    });
    expect(blockingReason(reading, "files")).toBe("stillReading");
    expect(blockingReason(readOwn(), "files")).toBeNull();
  });

  it("drops an answer to any but the latest reading", () => {
    const state = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
      { type: "readStarted", request: 1, fileIds: ["file-1"] },
      { type: "addFiles", files: [file("file-2")] },
      { type: "readStarted", request: 2, fileIds: ["file-1", "file-2"] },
    );
    const stale = wizardReducer(state, {
      type: "readDone",
      request: 1,
      reply: readReply([summary()]),
    });
    expect(stale).toBe(state);
    const fresh = wizardReducer(state, {
      type: "readDone",
      request: 2,
      reply: readReply([summary(), summary({ broker: "ibkr" })]),
    });
    expect(fresh.reading.status).toBe("read");
    expect(summaryOf(fresh, "file-2")?.broker).toBe("ibkr");
  });

  it("says when the reading failed, and when a file cannot be read", () => {
    const failed = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
      { type: "readStarted", request: 1, fileIds: ["file-1"] },
      {
        type: "readDone",
        request: 1,
        reply: { v: 1, id: 1, kind: "failed" },
      },
    );
    expect(blockingReason(failed, "files")).toBe("readFailed");
    for (const status of ["refused", "clash", "notRead"] as const) {
      const state = readOwn([summary(), summary({ status })]);
      expect(blockingReason(state, "files"), status).toBe("unreadableFile");
    }
    // A repeat is read once, which is no reason to stop.
    expect(
      blockingReason(
        readOwn([summary(), summary({ status: "repeat" })]),
        "files",
      ),
    ).toBeNull();
  });

  it("asks about accounts only with two Trading 212 files", () => {
    expect(asksAccounts(readOwn([summary()]))).toBe(false);
    expect(
      asksAccounts(readOwn([summary(), summary({ unnamedAccount: false })])),
    ).toBe(false);
    const two = readOwn([summary(), summary()]);
    expect(asksAccounts(two)).toBe(true);
    const separate = wizardReducer(two, {
      type: "setAccounts",
      accounts: "separate",
    });
    expect(separate.accounts).toBe("separate");
    expect(separate.reading).toEqual({ status: "idle" });
    expect(
      wizardReducer(separate, { type: "setAccounts", accounts: "separate" }),
    ).toBe(separate);
  });

  it("presets each payer from the export, and keeps what the user typed", () => {
    const read = readOwn();
    expect(read.payers["US1912161007"]).toEqual({
      name: "Coca-Cola",
      address: "",
      country: "US",
      id: "",
      sourceCountry: "",
    });
    const typed = wizardReducer(read, {
      type: "setPayer",
      isin: "US1912161007",
      field: "address",
      value: "One Coca-Cola Plaza, Atlanta",
    });
    // Read again: the typed address stays.
    const again = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
    );
    const reread = wizardReducer(
      wizardReducer(
        { ...again, payers: typed.payers },
        { type: "readStarted", request: 5, fileIds: ["file-1"] },
      ),
      { type: "readDone", request: 5, reply: readReply([summary()]) },
    );
    expect(reread.payers["US1912161007"]?.address).toBe(
      "One Coca-Cola Plaza, Atlanta",
    );
    expect(payerDetails(reread)).toEqual([
      {
        isin: "US1912161007",
        name: "Coca-Cola",
        address: "One Coca-Cola Plaza, Atlanta",
        country: "US",
        id: "",
        sourceCountry: "",
      },
    ]);
    // A payer not asked about cannot be set.
    expect(
      wizardReducer(read, {
        type: "setPayer",
        isin: "XX",
        field: "name",
        value: "y",
      }),
    ).toBe(read);
  });

  it("knows a payer is complete only with a name, an address and a country", () => {
    const whole = {
      name: "A",
      address: "B",
      country: "US",
      id: "",
      sourceCountry: "",
    };
    expect(isPayerIncomplete(whole, "US")).toBe(false);
    expect(isPayerIncomplete(undefined, "US")).toBe(true);
    expect(isPayerIncomplete({ ...whole, address: " " }, "US")).toBe(true);
    expect(isPayerIncomplete({ ...whole, country: "" }, "US")).toBe(true);
    // Where the ISIN names no country, the income's country is asked too.
    expect(isPayerIncomplete(whole, "")).toBe(true);
    expect(isPayerIncomplete({ ...whole, sourceCountry: "KY" }, "")).toBe(
      false,
    );
  });

  it("requires a valid tax number before the review", () => {
    const atDetails = wizardReducer(readOwn(), { type: "next" });
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

  it("goes on from the review while either return can be written", () => {
    const atReview = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
      { type: "readStarted", request: 1, fileIds: ["file-1"] },
      { type: "readDone", request: 1, reply: readReply([summary()]) },
      { type: "setDetail", field: "taxNumber", value: "12345678" },
      { type: "goTo", screen: "review" },
      { type: "prepareStarted", request: 2, fileIds: ["file-1"] },
    );
    expect(blockingReason(atReview, "review")).toBe("notPrepared");
    expect(canEnter(atReview, "download")).toBe(false);
    const done = (kdvp: FormOutput, div: FormOutput) =>
      wizardReducer(atReview, {
        type: "prepareDone",
        request: 2,
        reply: prepareReply(kdvp, div),
      });
    const oneWritten = done(form(), form({ xml: null, blocking: 1 }));
    expect(blockingReason(oneWritten, "review")).toBeNull();
    expect(canEnter(oneWritten, "download")).toBe(true);
    const noneWritten = done(
      form({ xml: null, blocking: 2 }),
      form({ xml: null, blocking: 2 }),
    );
    expect(blockingReason(noneWritten, "review")).toBe("nothingWritten");
    // Nothing to file at all goes on, to say so.
    const nothingDue = done(
      form({ xml: null, needed: false }),
      form({ xml: null, needed: false }),
    );
    expect(blockingReason(nothingDue, "review")).toBeNull();
    // A late answer to an older preparation is dropped.
    expect(
      wizardReducer(atReview, {
        type: "prepareDone",
        request: 1,
        reply: prepareReply(form(), form()),
      }),
    ).toBe(atReview);
  });

  it("prepares again after any change to the details or a payer", () => {
    const prepared = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
      { type: "readStarted", request: 1, fileIds: ["file-1"] },
      { type: "readDone", request: 1, reply: readReply([summary()]) },
      { type: "prepareStarted", request: 2, fileIds: ["file-1"] },
      {
        type: "prepareDone",
        request: 2,
        reply: prepareReply(form(), form()),
      },
    );
    expect(prepared.preparing.status).toBe("prepared");
    expect(
      wizardReducer(prepared, {
        type: "setDetail",
        field: "name",
        value: "Ana",
      }).preparing,
    ).toEqual({ status: "idle" });
    expect(
      wizardReducer(prepared, {
        type: "setPayer",
        isin: "US1912161007",
        field: "address",
        value: "x",
      }).preparing,
    ).toEqual({ status: "idle" });
  });

  it("tries a failed preparation again when the review is next opened", () => {
    const failed = run(
      { type: "startOwn" },
      { type: "addFiles", files: [file("file-1")] },
      { type: "readStarted", request: 1, fileIds: ["file-1"] },
      { type: "readDone", request: 1, reply: readReply([summary()]) },
      { type: "setDetail", field: "taxNumber", value: "12345678" },
      { type: "goTo", screen: "review" },
      { type: "prepareStarted", request: 2, fileIds: ["file-1"] },
      {
        type: "prepareDone",
        request: 2,
        reply: { v: 1, id: 2, kind: "failed" },
      },
    );
    expect(failed.preparing.status).toBe("failed");
    const back = wizardReducer(failed, { type: "back" });
    expect(back.preparing).toEqual({ status: "idle" });
  });

  it("blocks the files step while an unsupported file is listed", () => {
    const state = run(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [file("file-1", "a.csv", 1), file("file-2", "b.xlsx", 1)],
      },
    );
    expect(state.files.map((f) => f.kind === "own" && f.supported)).toEqual([
      true,
      false,
    ]);
    expect(blockingReason(state, "files")).toBe("unsupportedFile");
    const fixed = wizardReducer(state, { type: "removeFile", id: "file-2" });
    expect(blockingReason(fixed, "files")).toBe("stillReading");
  });

  it("refuses to jump past a step that still blocks", () => {
    const state = run({ type: "startOwn" }, { type: "goTo", screen: "review" });
    expect(state.screen).toBe("files");
  });

  it("swaps own files for the demo files when asked, and forgets them", () => {
    const state = wizardReducer(
      wizardReducer(readOwn(), {
        type: "setDetail",
        field: "taxNumber",
        value: "12345678",
      }),
      { type: "useDemoFiles" },
    );
    expect(state.mode).toBe("demo");
    expect(state.files.every((f) => f.kind === "demo")).toBe(true);
    expect(state.details.taxNumber).toBe("");
    expect(state.payers).toEqual({});
    expect(state.reading).toEqual({ status: "idle" });
  });

  it("adding own files after the demo leaves demo mode and drops the demo files", () => {
    const state = run(
      { type: "startDemo" },
      { type: "addFiles", files: [file("file-1", "x.csv", 1)] },
    );
    expect(state.mode).toBe("own");
    expect(state.files.map((f) => f.kind)).toEqual(["own"]);
  });
});

describe("labelsOf", () => {
  it("names a second file of one name apart from the first", () => {
    const state = run(
      { type: "startOwn" },
      {
        type: "addFiles",
        files: [
          file("file-1", "export.csv"),
          file("file-2", "export.csv"),
          file("file-3", "export.csv (2)"),
        ],
      },
    );
    expect([...labelsOf(state.files).values()]).toEqual([
      "export.csv",
      "export.csv (2)",
      "export.csv (2) (2)",
    ]);
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
