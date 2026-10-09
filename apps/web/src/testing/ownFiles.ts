/**
 * The user's own files as the screen tests drive them: the broker fixtures,
 * read and prepared by the real engine (engine/handle.ts), and the wizard
 * states they lead to. For tests only; nothing in the app imports it.
 */
import ibkrXml from "../../../../packages/brokers/test/fixtures/ibkr/flex-activity-2025-2026.xml?raw";
import t212v3 from "../../../../packages/brokers/test/fixtures/trading212/t212-invest-v3-2025.csv?raw";
import t212v4 from "../../../../packages/brokers/test/fixtures/trading212/t212-invest-v4-2026.csv?raw";
import { handleRequest } from "../engine/handle";
import {
  PROTOCOL_VERSION,
  type PayerDetails,
  type PrepareReply,
  type ReadReply,
  type TaxpayerDetails,
} from "../engine/protocol";
import { loadRates } from "../engine/rates";
import {
  initialWizardState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "../state/wizard";

export const OWN_FILES = [
  { id: "file-1", name: "t212-2025.csv", text: t212v3 },
  { id: "file-2", name: "t212-2026.csv", text: t212v4 },
  { id: "file-3", name: "ibkr.xml", text: ibkrXml },
] as const;

export const TAXPAYER: TaxpayerDetails = {
  taxNumber: "12345678",
  name: "Ana Novak",
  address: "Trubarjeva 1",
  postCode: "1000",
  city: "Ljubljana",
  email: "",
};

export const COCA_COLA: PayerDetails = {
  isin: "US1912161007",
  name: "The Coca-Cola Company",
  address: "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
  country: "US",
  id: "",
  sourceCountry: "",
};

const files = OWN_FILES.map((f) => ({
  name: f.name,
  bytes: new TextEncoder().encode(f.text).buffer,
}));

const request = {
  v: PROTOCOL_VERSION,
  accounts: "same",
  taxYear: 2026,
} as const;

/** The engine's answers for the fixtures: read, and prepared with a payer. */
export async function engineReplies(
  payers: readonly PayerDetails[] = [COCA_COLA],
): Promise<{ readonly read: ReadReply; readonly prepared: PrepareReply }> {
  const read = await handleRequest(
    { ...request, id: 1, kind: "read", files },
    loadRates,
  );
  const prepared = await handleRequest(
    { ...request, id: 2, kind: "prepare", files, taxpayer: TAXPAYER, payers },
    loadRates,
  );
  if (read.kind !== "read" || prepared.kind !== "prepare") {
    throw new Error("The engine did not answer the fixtures");
  }
  return { read, prepared };
}

const fileIds = OWN_FILES.map((f) => f.id);

/** The fixtures added and read, then the actions given. */
export function ownState(
  read: ReadReply,
  ...actions: WizardAction[]
): WizardState {
  return [
    { type: "startOwn" },
    {
      type: "addFiles",
      files: OWN_FILES.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.text.length,
      })),
    },
    { type: "readStarted", request: 1, fileIds },
    { type: "readDone", request: 1, reply: read },
    ...actions,
  ].reduce<WizardState>(
    (state, action) => wizardReducer(state, action as WizardAction),
    initialWizardState,
  );
}

/** The fixtures read, the details entered and the review prepared. */
export function preparedState(
  read: ReadReply,
  prepared: PrepareReply,
  ...actions: WizardAction[]
): WizardState {
  return ownState(
    read,
    ...(Object.entries(TAXPAYER) as [keyof TaxpayerDetails, string][]).map(
      ([field, value]): WizardAction => ({ type: "setDetail", field, value }),
    ),
    { type: "goTo", screen: "review" },
    { type: "prepareStarted", request: 2, fileIds },
    { type: "prepareDone", request: 2, reply: prepared },
    ...actions,
  );
}
