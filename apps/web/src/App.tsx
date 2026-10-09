/**
 * The app root: theme, language, and the flow from the start screen to the
 * download. All state lives in memory; nothing is stored or sent anywhere.
 *
 * The user's own files are read in the engine worker (ADR 0013). Their bytes
 * are taken when a file is added and kept here, by file id, for as long as
 * the file is listed: removing it, choosing the demo or starting over drops
 * them. The reducer holds only what the engine answered.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { demoPreview } from "./demo/demoPreview";
import { createWorkerEngine, type Engine } from "./engine/client";
import type { BuiltReturns } from "./engine/demoReturns";
import {
  PROTOCOL_VERSION,
  type FailedReply,
  type RequestFile,
} from "./engine/protocol";
import type { Locale } from "./i18n/format";
import { I18nProvider, useI18n } from "./i18n/i18n";
import { DetailsStep } from "./screens/DetailsStep";
import { DownloadStep } from "./screens/DownloadStep";
import { FilesStep } from "./screens/FilesStep";
import { EmptyReview, ReviewStep } from "./screens/ReviewStep";
import { StartScreen } from "./screens/StartScreen";
import {
  blockingReason,
  initialWizardState,
  labelsOf,
  payerDetails,
  readableFiles,
  TAX_YEAR,
  wizardReducer,
  type WizardState,
} from "./state/wizard";
import {
  AppFooter,
  AppHeader,
  Main,
  SkipLink,
  type Theme,
} from "./ui/AppChrome";
import { DemoBanner } from "./ui/bits";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Button, Note } from "./ui/kit";
import { Stepper } from "./ui/Stepper";

/** The demo's returns, from the engine the download step loads when it opens. */
const writeDemoReturns = () =>
  import("./engine/demoReturns").then((engine) => engine.buildDemoReturns());

/** What a request that never reached the engine settles as. */
const FAILED: FailedReply = { v: PROTOCOL_VERSION, id: 0, kind: "failed" };

/** Where the review of the user's own files stands. */
function reviewStatus(state: WizardState): "ready" | "preparing" | "failed" {
  if (state.mode === "demo") return "ready";
  switch (state.preparing.status) {
    case "prepared":
      return "ready";
    case "failed":
      return "failed";
    default:
      return "preparing";
  }
}

function Frame({
  initialState,
  initialTheme,
  engine,
}: {
  readonly initialState: WizardState;
  readonly initialTheme: Theme;
  readonly engine: Engine;
}) {
  const { locale, t } = useI18n();
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const previousScreen = useRef(state.screen);
  // Each added file, by id, and its bytes once the engine first needs them:
  // a file refused unread is never read at all.
  const handles = useRef(new Map<string, File>());
  const bytes = useRef(new Map<string, Promise<ArrayBuffer>>());
  const nextFile = useRef(1);
  const nextRequest = useRef(1);
  const labels = labelsOf(state.files);
  const prepared =
    state.mode === "own" && state.preparing.status === "prepared"
      ? state.preparing.reply
      : null;
  const preview =
    state.mode === "demo" ? demoPreview : (prepared?.preview ?? null);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // The page behind the app (overscroll, scrollbars, the browser's own
  // toolbar color) follows the theme too.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = theme;
    const background = getComputedStyle(root).getPropertyValue("--bg").trim();
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background);
  }, [theme]);

  // The tab title names the screen, so history entries and screen readers can
  // tell the steps apart.
  useEffect(() => {
    document.title =
      state.screen === "start"
        ? t.app.name
        : `${t.stepper[state.screen]} · ${t.app.name}`;
  }, [state.screen, t]);

  // A new screen replaces the whole content: move focus to its heading so
  // keyboard and screen-reader users land at its start, hearing which screen it
  // is, instead of on a vanished button.
  useEffect(() => {
    if (previousScreen.current === state.screen) return;
    previousScreen.current = state.screen;
    window.scrollTo({ top: 0 });
    const target =
      document.querySelector<HTMLElement>("#main h1") ??
      document.getElementById("main");
    target?.focus({ preventScroll: true });
  }, [state.screen]);

  // A file no longer listed (or never listed, from a drop larger than a
  // session) takes its bytes with it.
  useEffect(() => {
    const listed = new Set(state.files.map((f) => f.id));
    for (const id of handles.current.keys()) {
      if (!listed.has(id)) handles.current.delete(id);
    }
    for (const id of bytes.current.keys()) {
      if (!listed.has(id)) bytes.current.delete(id);
    }
  });

  // Own files live only in this tab: closing or reloading it loses them, so
  // the browser asks first (it shows its own words, not ours).
  const holdsOwnFiles = state.files.some((f) => f.kind === "own");
  useEffect(() => {
    if (!holdsOwnFiles) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", ask);
    return () => {
      window.removeEventListener("beforeunload", ask);
    };
  }, [holdsOwnFiles]);

  /** The bytes of a listed file, read once, when first asked for. */
  function bytesOf(id: string): Promise<ArrayBuffer> {
    const read = bytes.current.get(id);
    if (read !== undefined) return read;
    const file = handles.current.get(id);
    if (file === undefined) {
      return Promise.reject(new Error("A file without its bytes"));
    }
    const content = file.arrayBuffer();
    bytes.current.set(id, content);
    return content;
  }

  /** The request's files, by id, named by their labels. */
  async function requestFiles(
    fileIds: readonly string[],
  ): Promise<RequestFile[]> {
    return Promise.all(
      fileIds.map(async (id) => ({
        name: labels.get(id) ?? id,
        bytes: await bytesOf(id),
      })),
    );
  }

  // Read the own files again whenever what the engine would read changed:
  // every such change sets the reading back to idle.
  useEffect(() => {
    const { reading } = state;
    const readable = readableFiles(state);
    if (state.mode !== "own" || reading.status !== "idle") return;
    if (readable.length === 0) return;
    const request = nextRequest.current;
    nextRequest.current += 1;
    const fileIds = readable.map((f) => f.id);
    dispatch({ type: "readStarted", request, fileIds });
    void requestFiles(fileIds)
      .then((files) =>
        engine.read({ files, accounts: state.accounts, taxYear: TAX_YEAR }),
      )
      .catch(() => FAILED)
      .then((reply) => {
        dispatch({ type: "readDone", request, reply });
      });
  });

  // The review of own files is prepared when it opens, from what is entered;
  // a change to any of it sets the preparation back to idle.
  useEffect(() => {
    const { preparing, reading } = state;
    if (state.mode !== "own" || state.screen !== "review") return;
    if (preparing.status !== "idle" || reading.status !== "read") return;
    const request = nextRequest.current;
    nextRequest.current += 1;
    const { fileIds } = reading;
    dispatch({ type: "prepareStarted", request, fileIds });
    void requestFiles(fileIds)
      .then((files) =>
        engine.prepare({
          files,
          accounts: state.accounts,
          taxYear: TAX_YEAR,
          taxpayer: state.details,
          payers: payerDetails(state),
        }),
      )
      .catch(() => FAILED)
      .then((reply) => {
        dispatch({ type: "prepareDone", request, reply });
      });
  });

  const addFiles = (chosen: readonly File[]) => {
    const files = chosen.map((file) => {
      const id = `file-${String(nextFile.current)}`;
      nextFile.current += 1;
      // A handle only: nothing is read until the engine is asked to.
      handles.current.set(id, file);
      return { id, name: file.name, size: file.size };
    });
    dispatch({ type: "addFiles", files });
  };

  const ownReturns = useMemo((): BuiltReturns | null => {
    if (prepared === null) return null;
    const year = String(TAX_YEAR);
    // The names last: nothing in a reply can rename a download.
    return {
      kdvp: { ...prepared.kdvp, fileName: `Doh_KDVP_${year}.xml` },
      div: { ...prepared.div, fileName: `Doh_Div_${year}.xml` },
    };
  }, [prepared]);

  const startDemo = () => {
    dispatch({ type: "startDemo" });
  };
  const back = () => {
    dispatch({ type: "back" });
  };
  const next = () => {
    dispatch({ type: "next" });
  };
  const fileNames =
    state.preparing.status === "idle"
      ? []
      : state.preparing.fileIds.map((id) => labels.get(id) ?? id);
  const demoBlocked = demoPreview.findings.some(
    (f) => f.severity === "blocking",
  );

  return (
    <div className="app" data-theme={theme}>
      <SkipLink />
      <AppHeader
        onHome={() => {
          dispatch({ type: "restart" });
        }}
        theme={theme}
        onToggleTheme={() => {
          setTheme(theme === "dark" ? "light" : "dark");
        }}
      />
      <Main>
        {state.screen === "start" ? (
          <StartScreen
            onStartDemo={startDemo}
            onStartOwn={() => {
              dispatch({ type: "startOwn" });
            }}
          />
        ) : (
          <div className="container flow">
            <Stepper
              state={state}
              onGoTo={(screen) => {
                dispatch({ type: "goTo", screen });
              }}
            />
            {state.mode === "demo" ? <DemoBanner /> : null}
            <ErrorBoundary
              resetKey={state.screen}
              fallback={
                <div className="screen">
                  <Note tone="danger" role="alert">
                    {t.app.crashed}
                  </Note>
                  <div className="actions-row">
                    <Button size="lg" onClick={back}>
                      {t.nav.back}
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={() => {
                        dispatch({ type: "restart" });
                      }}
                    >
                      {t.download.startOver}
                    </Button>
                  </div>
                </div>
              }
            >
              {state.screen === "files" ? (
                <FilesStep
                  state={state}
                  taxYear={TAX_YEAR}
                  onAddFiles={addFiles}
                  onRemoveFile={(id) => {
                    dispatch({ type: "removeFile", id });
                  }}
                  onSetAccounts={(choice) => {
                    dispatch({ type: "setAccounts", accounts: choice });
                  }}
                  onUseDemoFiles={() => {
                    dispatch({ type: "useDemoFiles" });
                  }}
                  onBack={back}
                  onNext={next}
                />
              ) : null}
              {state.screen === "details" ? (
                <DetailsStep
                  state={state}
                  onChange={(field, value) => {
                    dispatch({ type: "setDetail", field, value });
                  }}
                  onPayerChange={(isin, field, value) => {
                    dispatch({ type: "setPayer", isin, field, value });
                  }}
                  onBack={back}
                  onNext={next}
                />
              ) : null}
              {state.screen === "review" ? (
                <ReviewStep
                  preview={preview}
                  status={reviewStatus(state)}
                  fileNames={fileNames}
                  forms={
                    prepared === null
                      ? null
                      : { kdvp: prepared.kdvp, div: prepared.div }
                  }
                  canContinue={
                    state.mode === "own"
                      ? blockingReason(state, "review") === null
                      : !demoBlocked
                  }
                  onBack={back}
                  onNext={next}
                  onStartDemo={startDemo}
                />
              ) : null}
              {state.screen === "download" ? (
                preview === null ||
                (state.mode === "own" && ownReturns === null) ? (
                  // Unreachable through the flow (own files block at the
                  // review until prepared), but never render a blank screen.
                  <EmptyReview onStartDemo={startDemo} />
                ) : (
                  <DownloadStep
                    preview={preview}
                    demo={state.mode === "demo"}
                    returns={ownReturns ?? writeDemoReturns}
                    onBack={back}
                    onRestart={() => {
                      dispatch({ type: "restart" });
                    }}
                  />
                )
              ) : null}
            </ErrorBoundary>
          </div>
        )}
      </Main>
      <AppFooter />
    </div>
  );
}

export function App({
  initialLocale = "sl",
  initialState = initialWizardState,
  initialTheme = "dark",
  engine,
}: {
  readonly initialLocale?: Locale;
  /** Lets tests render any screen without simulating clicks. */
  readonly initialState?: WizardState;
  readonly initialTheme?: Theme;
  /** The engine; tests pass a fake, the app starts its worker when needed. */
  readonly engine?: Engine;
}) {
  // One engine for the app's life: its worker starts on the first request.
  const [running] = useState(() => engine ?? createWorkerEngine());
  return (
    <I18nProvider initialLocale={initialLocale}>
      <Frame
        initialState={initialState}
        initialTheme={initialTheme}
        engine={running}
      />
    </I18nProvider>
  );
}
