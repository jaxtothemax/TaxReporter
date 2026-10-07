/**
 * The import → details → review → download flow as a pure reducer, so every
 * navigation rule is unit-testable without a DOM.
 *
 * Two modes: "demo" walks the flow on the bundled demo data, "own" holds the
 * user's own files. Reading broker files is not built yet, so in "own" mode the
 * files are kept as names and sizes only, never read, and the review shows an
 * empty state that points to the demo.
 */
import { demoPreview } from "../demo/demoPreview";
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

export interface WizardState {
  readonly screen: Screen;
  readonly mode: Mode;
  readonly files: readonly AddedFile[];
  readonly details: Details;
  /** Set when the user tried to move on past a step that still has errors. */
  readonly showErrors: boolean;
  /** Source of ids for the user's own files; ids only need to be unique here. */
  readonly nextFileId: number;
}

export type WizardAction =
  | { readonly type: "startDemo" }
  | { readonly type: "startOwn" }
  | { readonly type: "useDemoFiles" }
  | {
      readonly type: "addFiles";
      readonly files: readonly {
        readonly name: string;
        readonly size: number;
      }[];
    }
  | { readonly type: "removeFile"; readonly id: string }
  | {
      readonly type: "setDetail";
      readonly field: keyof Details;
      readonly value: string;
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

export const initialWizardState: WizardState = {
  screen: "start",
  mode: "own",
  files: [],
  details: EMPTY_DETAILS,
  showErrors: false,
  nextFileId: 1,
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
  "needFiles" | "unsupportedFile" | "taxNumber" | "noResults";

/** Why a step cannot be left forward, or null when it can. */
export function blockingReason(
  state: WizardState,
  step: FlowStep,
): BlockingReason | null {
  if (step === "files" && state.files.length === 0) return "needFiles";
  if (
    step === "files" &&
    state.files.some((f) => f.kind === "own" && !f.supported)
  ) {
    return "unsupportedFile";
  }
  // The demo needs no personal data; a real return cannot be built without it.
  if (
    step === "details" &&
    state.mode === "own" &&
    !isValidTaxNumber(state.details.taxNumber)
  ) {
    return "taxNumber";
  }
  // Own files are not read yet, so there is nothing to download from them.
  if (step === "review" && state.mode === "own") return "noResults";
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
      // Switching to the demo replaces the user's unread files: mixing made-up
      // and real data in one review would be meaningless.
      return {
        ...state,
        mode: "demo",
        files: demoFiles(),
        showErrors: false,
      };
    case "addFiles": {
      if (action.files.length === 0) return state;
      const added: AddedFile[] = action.files.map((file, i) => ({
        kind: "own",
        id: `file-${String(state.nextFileId + i)}`,
        name: file.name,
        size: file.size,
        supported: isSupportedFile(file.name),
      }));
      return {
        ...state,
        mode: "own",
        files: [...state.files.filter((f) => f.kind === "own"), ...added],
        nextFileId: state.nextFileId + added.length,
        showErrors: false,
      };
    }
    case "removeFile":
      return { ...state, files: state.files.filter((f) => f.id !== action.id) };
    case "setDetail":
      return {
        ...state,
        details: { ...state.details, [action.field]: action.value },
      };
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
      };
    case "goTo":
      return canEnter(state, action.screen)
        ? { ...state, screen: action.screen, showErrors: false }
        : state;
    case "restart":
      return initialWizardState;
  }
}
