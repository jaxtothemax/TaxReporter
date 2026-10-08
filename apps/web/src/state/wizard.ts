/**
 * The import → details → review → download flow as a pure reducer, so every
 * navigation rule is unit-testable without a DOM.
 *
 * Two modes: "demo" walks the flow on the bundled demo data, "own" reads the
 * user's own files in the engine worker (ADR 0013). The reducer holds what
 * the engine answered, never the files themselves: their bytes live with the
 * app, outside any state that could be logged or kept. Each answer carries
 * the number of the request it answers, and an answer to any but the latest
 * request is dropped, so a slow read can never overwrite a newer one.
 */
import type { AccountChoice } from "@taxreporter/pipeline";

import { demoPreview } from "../demo/demoPreview";
import type {
  FailedReply,
  FileSummary,
  PayerDetails,
  PrepareReply,
  ReadReply,
} from "../engine/protocol";
import type { BrokerId, IsoDate } from "../model/preview";

/** The tax year v0.1 prepares returns for (filed by 1 March 2027). */
export const TAX_YEAR = 2026;

export const FLOW_STEPS = ["files", "details", "review", "download"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];
export type Screen = "start" | FlowStep;
export type Mode = "demo" | "own";

export type AddedFile =
  | {
      readonly kind: "demo";
      readonly id: string;
      readonly name: string;
      readonly broker: BrokerId;
      readonly firstDate: IsoDate;
      readonly lastDate: IsoDate;
      readonly rowsRead: number;
    }
  | {
      readonly kind: "own";
      readonly id: string;
      readonly name: string;
      readonly size: number;
      /** Only CSV and XML exports can ever be read; anything else is refused. */
      readonly supported: boolean;
    };

export interface Details {
  readonly taxNumber: string;
  readonly name: string;
  readonly address: string;
  readonly postCode: string;
  readonly city: string;
  readonly email: string;
}

/** A dividend payer's details as the user types them, by ISIN. */
export type PayerDraft = Omit<PayerDetails, "isin">;

/** The engine's reading of the own files, for the files it was asked about. */
export type Reading =
  | { readonly status: "idle" }
  | {
      readonly status: "reading" | "failed";
      readonly request: number;
      /** The files read, by id, in the order the request named them. */
      readonly fileIds: readonly string[];
    }
  | {
      readonly status: "read";
      readonly request: number;
      readonly fileIds: readonly string[];
      readonly reply: ReadReply;
    };

/** The returns the engine prepared from the files and the details. */
export type Preparing =
  | { readonly status: "idle" }
  | {
      readonly status: "preparing" | "failed";
      readonly request: number;
      readonly fileIds: readonly string[];
    }
  | {
      readonly status: "prepared";
      readonly request: number;
      readonly fileIds: readonly string[];
      readonly reply: PrepareReply;
    };

export interface WizardState {
  readonly screen: Screen;
  readonly mode: Mode;
  readonly files: readonly AddedFile[];
  readonly details: Details;
  /** Whether Trading 212 files, which do not name their account, are one. */
  readonly accounts: AccountChoice;
  readonly payers: Readonly<Record<string, PayerDraft>>;
  readonly reading: Reading;
  readonly preparing: Preparing;
  /** Set when the user tried to move on past a step that still has errors. */
  readonly showErrors: boolean;
}

export type WizardAction =
  | { readonly type: "startDemo" }
  | { readonly type: "startOwn" }
  | { readonly type: "useDemoFiles" }
  | {
      readonly type: "addFiles";
      /** Each with an id unique in the session, under which the app keeps its bytes. */
      readonly files: readonly {
        readonly id: string;
        readonly name: string;
        readonly size: number;
      }[];
    }
  | { readonly type: "removeFile"; readonly id: string }
  | { readonly type: "setAccounts"; readonly accounts: AccountChoice }
  | {
      readonly type: "setDetail";
      readonly field: keyof Details;
      readonly value: string;
    }
  | {
      readonly type: "setPayer";
      readonly isin: string;
      readonly field: keyof PayerDraft;
      readonly value: string;
    }
  | {
      readonly type: "readStarted";
      readonly request: number;
      readonly fileIds: readonly string[];
    }
  | {
      readonly type: "readDone";
      readonly request: number;
      readonly reply: ReadReply | FailedReply;
    }
  | {
      readonly type: "prepareStarted";
      readonly request: number;
      readonly fileIds: readonly string[];
    }
  | {
      readonly type: "prepareDone";
      readonly request: number;
      readonly reply: PrepareReply | FailedReply;
    }
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "goTo"; readonly screen: Screen }
  | { readonly type: "restart" };

const EMPTY_DETAILS: Details = {
  taxNumber: "",
  name: "",
  address: "",
  postCode: "",
  city: "",
  email: "",
};

const IDLE = { status: "idle" } as const;

export const initialWizardState: WizardState = {
  screen: "start",
  mode: "own",
  files: [],
  details: EMPTY_DETAILS,
  accounts: "same",
  payers: {},
  reading: IDLE,
  preparing: IDLE,
  showErrors: false,
};

/** Spaces are allowed while typing ("1234 5678") and dropped before checking. */
export function normalizeTaxNumber(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * The XSD's pattern for edp:taxNumber is exactly eight digits, and the schema
 * does not make the element required, so the app must (docs/research/01).
 */
export function isValidTaxNumber(value: string): boolean {
  return /^\d{8}$/.test(normalizeTaxNumber(value));
}

/** Trading 212 exports CSV and IBKR Flex Queries XML; nothing else is read. */
export function isSupportedFile(name: string): boolean {
  return /\.(csv|xml)$/i.test(name);
}

/**
 * Each file's name as findings and the engine know it: unique in the
 * session, "name (2)" for a second file of one name, so a finding about one
 * of them says which.
 */
export function labelsOf(
  files: readonly AddedFile[],
): ReadonlyMap<string, string> {
  const used = new Set<string>();
  const labels = new Map<string, string>();
  for (const file of files) {
    let label = file.name;
    for (let n = 2; used.has(label); n += 1) {
      label = `${file.name} (${String(n)})`;
    }
    used.add(label);
    labels.set(file.id, label);
  }
  return labels;
}

/** The own files the engine is asked to read: those that can be. */
export function readableFiles(state: WizardState): readonly AddedFile[] {
  return state.files.filter((f) => f.kind === "own" && f.supported);
}

/** The engine's summary of a file, once the latest reading names it. */
export function summaryOf(
  state: WizardState,
  id: string,
): FileSummary | undefined {
  if (state.reading.status !== "read") return undefined;
  const position = state.reading.fileIds.indexOf(id);
  return position < 0 ? undefined : state.reading.reply.files[position];
}

/** Whether to ask if the Trading 212 files are one account: two or more. */
export function asksAccounts(state: WizardState): boolean {
  if (state.reading.status !== "read") return false;
  return (
    state.reading.reply.files.filter(
      (f) => f.status === "read" && f.unnamedAccount,
    ).length >= 2
  );
}

/** The payer drafts the review is prepared with, one per payer asked about. */
export function payerDetails(state: WizardState): PayerDetails[] {
  if (state.reading.status !== "read") return [];
  return state.reading.reply.payers.flatMap((prompt) => {
    const draft = state.payers[prompt.isin];
    return draft === undefined ? [] : [{ isin: prompt.isin, ...draft }];
  });
}

/** A payer still missing what Doh-Div needs of every payer. */
export function isPayerIncomplete(
  draft: PayerDraft | undefined,
  isinCountry: string,
): boolean {
  return (
    draft === undefined ||
    draft.name.trim() === "" ||
    draft.address.trim() === "" ||
    draft.country === "" ||
    (isinCountry === "" && draft.sourceCountry === "")
  );
}

/** Whether the prepared returns hold a form to download, or need none. */
function hasDownload(reply: PrepareReply): boolean {
  const forms = [reply.kdvp, reply.div];
  return (
    forms.some((form) => form.xml !== null) ||
    forms.every((form) => !form.needed)
  );
}

function demoFiles(): AddedFile[] {
  return demoPreview.files.map((file) => ({
    kind: "demo",
    id: `demo-${file.broker}`,
    name: file.name,
    broker: file.broker,
    firstDate: file.firstDate,
    lastDate: file.lastDate,
    rowsRead: file.rowsRead,
  }));
}

export type BlockingReason =
  | "needFiles"
  | "unsupportedFile"
  | "stillReading"
  | "readFailed"
  | "unreadableFile"
  | "taxNumber"
  | "notPrepared"
  | "nothingWritten";

const UNREADABLE = new Set(["refused", "clash", "notRead"]);

/** Why a step cannot be left forward, or null when it can. */
export function blockingReason(
  state: WizardState,
  step: FlowStep,
): BlockingReason | null {
  if (step === "files") {
    if (state.files.length === 0) return "needFiles";
    if (state.files.some((f) => f.kind === "own" && !f.supported)) {
      return "unsupportedFile";
    }
    if (state.mode === "demo") return null;
    const { reading } = state;
    if (reading.status === "failed") return "readFailed";
    if (reading.status !== "read") return "stillReading";
    if (reading.reply.files.some((f) => UNREADABLE.has(f.status))) {
      return "unreadableFile";
    }
    return null;
  }
  // The demo needs no personal data; a real return cannot be built without it.
  if (
    step === "details" &&
    state.mode === "own" &&
    !isValidTaxNumber(state.details.taxNumber)
  ) {
    return "taxNumber";
  }
  if (step === "review" && state.mode === "own") {
    if (state.preparing.status !== "prepared") return "notPrepared";
    if (!hasDownload(state.preparing.reply)) return "nothingWritten";
  }
  return null;
}

/** A step is reachable when every step before it can be left forward. */
export function canEnter(state: WizardState, screen: Screen): boolean {
  if (screen === "start") return true;
  const index = FLOW_STEPS.indexOf(screen);
  return FLOW_STEPS.slice(0, index).every(
    (step) => blockingReason(state, step) === null,
  );
}

function neighbor(screen: Screen, offset: 1 | -1): Screen {
  if (screen === "start") return offset === 1 ? "files" : "start";
  return FLOW_STEPS[FLOW_STEPS.indexOf(screen) + offset] ?? "start";
}

/** Anything that changes what the engine would read starts it over. */
function filesChanged(state: WizardState): WizardState {
  return { ...state, reading: IDLE, preparing: IDLE };
}

/** New payers get their details preset from the export; typed ones stay. */
function presetPayers(
  payers: Readonly<Record<string, PayerDraft>>,
  reply: ReadReply,
): Readonly<Record<string, PayerDraft>> {
  const next = { ...payers };
  for (const prompt of reply.payers) {
    next[prompt.isin] ??= {
      name: prompt.name,
      address: "",
      country: prompt.isinCountry,
      id: "",
      sourceCountry: "",
    };
  }
  return next;
}

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "startDemo":
      return {
        ...initialWizardState,
        screen: "files",
        mode: "demo",
        files: demoFiles(),
      };
    case "startOwn":
      return { ...initialWizardState, screen: "files", mode: "own" };
    case "useDemoFiles":
      // Switching to the demo replaces the user's files and what was typed
      // for them: mixing made-up and real data in one review would be
      // meaningless.
      return {
        ...initialWizardState,
        screen: state.screen,
        mode: "demo",
        files: demoFiles(),
      };
    case "addFiles": {
      if (action.files.length === 0) return state;
      const added: AddedFile[] = action.files.map((file) => ({
        kind: "own",
        id: file.id,
        name: file.name,
        size: file.size,
        supported: isSupportedFile(file.name),
      }));
      return filesChanged({
        ...state,
        mode: "own",
        files: [...state.files.filter((f) => f.kind === "own"), ...added],
        showErrors: false,
      });
    }
    case "removeFile": {
      const files = state.files.filter((f) => f.id !== action.id);
      return files.length === state.files.length
        ? state
        : filesChanged({ ...state, files });
    }
    case "setAccounts":
      return action.accounts === state.accounts
        ? state
        : filesChanged({ ...state, accounts: action.accounts });
    case "setDetail":
      return {
        ...state,
        details: { ...state.details, [action.field]: action.value },
        preparing: IDLE,
      };
    case "setPayer": {
      const draft = state.payers[action.isin];
      if (draft === undefined) return state;
      return {
        ...state,
        payers: {
          ...state.payers,
          [action.isin]: { ...draft, [action.field]: action.value },
        },
        preparing: IDLE,
      };
    }
    case "readStarted":
      return {
        ...state,
        reading: {
          status: "reading",
          request: action.request,
          fileIds: action.fileIds,
        },
      };
    case "readDone": {
      const { reading } = state;
      if (reading.status !== "reading" || reading.request !== action.request) {
        return state;
      }
      const { fileIds, request } = reading;
      if (action.reply.kind === "failed") {
        return { ...state, reading: { status: "failed", request, fileIds } };
      }
      return {
        ...state,
        reading: { status: "read", request, fileIds, reply: action.reply },
        payers: presetPayers(state.payers, action.reply),
      };
    }
    case "prepareStarted":
      return {
        ...state,
        preparing: {
          status: "preparing",
          request: action.request,
          fileIds: action.fileIds,
        },
      };
    case "prepareDone": {
      const { preparing } = state;
      if (
        preparing.status !== "preparing" ||
        preparing.request !== action.request
      ) {
        return state;
      }
      const { fileIds, request } = preparing;
      return {
        ...state,
        preparing:
          action.reply.kind === "failed"
            ? { status: "failed", request, fileIds }
            : { status: "prepared", request, fileIds, reply: action.reply },
      };
    }
    case "next": {
      if (
        state.screen !== "start" &&
        blockingReason(state, state.screen) !== null
      ) {
        return { ...state, showErrors: true };
      }
      return { ...state, screen: neighbor(state.screen, 1), showErrors: false };
    }
    case "back":
      return {
        ...state,
        screen: neighbor(state.screen, -1),
        showErrors: false,
        // A failed preparation is tried again when the review next opens.
        ...(state.preparing.status === "failed" ? { preparing: IDLE } : {}),
      };
    case "goTo":
      return canEnter(state, action.screen)
        ? { ...state, screen: action.screen, showErrors: false }
        : state;
    case "restart":
      return initialWizardState;
  }
}
