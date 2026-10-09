/**
 * The app root: theme, language, and the flow from the start screen to the
 * download. All state lives in memory; nothing is stored or sent anywhere.
 *
 * The user's own files are read in the engine worker (ADR 0013). Their bytes
 * are taken when a file is added and kept here, by file id, for as long as
 * the file is listed: removing it, choosing the demo or starting over drops
 * them. The reducer holds only what the engine answered.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { demoPreview } from "./demo/demoPreview";
import { createWorkerEngine, type Engine } from "./engine/client";
import type { BuiltReturns } from "./engine/demoReturns";
import { createRunner } from "./engine/runner";
import type { Locale } from "./i18n/format";
import { I18nProvider, useI18n } from "./i18n/i18n";
import { DetailsStep } from "./screens/DetailsStep";
import { DownloadStep, formFileName } from "./screens/DownloadStep";
import { FilesStep } from "./screens/FilesStep";
import {
  EmptyReview,
  initialReviewView,
  ReviewStep,
  type ReviewView,
} from "./screens/ReviewStep";
import { StartScreen } from "./screens/StartScreen";
import {
  createTourReducer,
  initialTourState,
  type TourState,
} from "./tour/machine";
import { NOTE_COUNTS, TOUR } from "./tour/script";
import { focusTarget, TourLayer, type TourRestore } from "./tour/TourLayer";
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
import { Button, cx, Note } from "./ui/kit";
import { Stepper } from "./ui/Stepper";

/** The guided tour's reducer, over the script's stops (tour/script.ts). */
const tourReducer = createTourReducer(NOTE_COUNTS);

const noRestore = (focus: TourRestore["focus"] = "heading"): TourRestore => ({
  focus,
  scrollY: null,
  scrollers: new Map(),
});

/** The demo's returns, from the engine the download step loads when it opens. */
const writeDemoReturns = () =>
  import("./engine/demoReturns").then((engine) => engine.buildDemoReturns());

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
  initialTour,
  engine,
}: {
  readonly initialState: WizardState;
  readonly initialTheme: Theme;
  readonly initialTour: TourState;
  readonly engine: Engine;
}) {
  const { locale, t } = useI18n();
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  // The guided tour (#27, ADR 0016) sits next to the wizard, not in it:
  // starting over resets the wizard and never re-arms the tour.
  const [tour, tourDispatch] = useReducer(tourReducer, initialTour);
  const restore = useRef<TourRestore>(noRestore());
  const restorePending = useRef(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // The review's tab and open securities. Leaving the review resets them, as
  // they were reset when the review's own state went with it.
  const [reviewView, setReviewView] = useState<ReviewView>(initialReviewView);
  const [viewScreen, setViewScreen] = useState(state.screen);
  if (viewScreen !== state.screen) {
    setViewScreen(state.screen);
    if (state.screen !== "review") setReviewView(initialReviewView);
  }
  const previousScreen = useRef(state.screen);
  // Each added file, by id, and its bytes once the engine first needs them:
  // a file refused unread is never read at all.
  const handles = useRef(new Map<string, File>());
  const bytes = useRef(new Map<string, Promise<ArrayBuffer>>());
  const nextFile = useRef(1);
  const labels = labelsOf(state.files);
  // The runner asks for labels when a request starts, after this render.
  const latestLabels = useRef(labels);
  latestLabels.current = labels;
  const prepared =
    state.mode === "own" && state.preparing.status === "prepared"
      ? state.preparing.reply
      : null;
  const preview =
    state.mode === "demo" ? demoPreview : (prepared?.preview ?? null);

  // While a tour stop runs, the app shows the stop's screen, tab and rows in
  // place of the user's; the wizard's state is never changed, so ending the
  // tour brings the user's view back as it was.
  const tourRun = state.mode === "demo" ? tour.run : null;
  const tourOpen = useRef(false);
  tourOpen.current = tourRun !== null;

  // The tour belongs to the demo: leaving it ends the tour, so a later entry
  // never resumes a stale stop. (The modal dialog makes this unreachable while
  // the tour shows; the reducer state would outlive it otherwise.)
  useEffect(() => {
    if (state.mode !== "demo" && tour.run !== null) {
      tourDispatch({ type: "exit" });
    }
  }, [state.mode, tour.run]);
  const stop = tourRun === null ? undefined : TOUR[tourRun.stop];
  const shownScreen = stop?.view.screen ?? state.screen;
  const shown: WizardState =
    shownScreen === state.screen ? state : { ...state, screen: shownScreen };
  const shownReview = stop?.view.review ?? reviewView;

  // The tour has ended: give back the scroll and the focus it took. The
  // user's own view is already back, by construction, in this commit.
  useLayoutEffect(() => {
    if (tour.run !== null || !restorePending.current) return;
    restorePending.current = false;
    const { focus, scrollY, scrollers } = restore.current;
    for (const [scroller, left] of scrollers) {
      if (scroller.isConnected) scroller.scrollLeft = left;
    }
    if (scrollY !== null)
      window.scrollTo({ top: scrollY, behavior: "instant" });
    const back = focusTarget(focus);
    back?.focus({ preventScroll: true });
    // A browser may still hand focus back to what had it before the dialog
    // opened, after this runs (WebKit does): give it to the target again.
    requestAnimationFrame(() => {
      if (back?.isConnected === true && document.activeElement !== back) {
        back.focus({ preventScroll: true });
      }
    });
    restore.current = noRestore();
  }, [tour.run]);

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
  //
  // While the guided tour is open it owns focus and scroll: a focus here would
  // land behind the modal dialog (WebKit grants it, then drops focus to the
  // body), and the tour gives the screen back, focused, when it ends.
  useEffect(() => {
    if (previousScreen.current === state.screen) return;
    previousScreen.current = state.screen;
    if (tourOpen.current) return;
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

  // One runner for the app's life: it numbers requests across both kinds,
  // so a read started after a preparation makes the preparation stale.
  const [runner] = useState(() =>
    createRunner({
      engine,
      bytesOf: (id) => {
        const read = bytes.current.get(id);
        if (read !== undefined) return read;
        const file = handles.current.get(id);
        if (file === undefined) {
          return Promise.reject(new Error("A file without its bytes"));
        }
        const content = file.arrayBuffer();
        bytes.current.set(id, content);
        return content;
      },
      labelOf: (id) => latestLabels.current.get(id) ?? id,
      dispatch,
    }),
  );

  // Read the own files again whenever what the engine would read changed:
  // every such change sets the reading back to idle.
  useEffect(() => {
    const readable = readableFiles(state);
    if (state.mode !== "own" || state.reading.status !== "idle") return;
    if (readable.length === 0) return;
    runner.read(
      readable.map((f) => f.id),
      state.accounts,
      TAX_YEAR,
    );
  });

  // The review of own files is prepared when it opens, from what is entered;
  // a change to any of it sets the preparation back to idle.
  useEffect(() => {
    const { preparing, reading } = state;
    if (state.mode !== "own" || state.screen !== "review") return;
    if (preparing.status !== "idle" || reading.status !== "read") return;
    runner.prepare(
      reading.fileIds,
      state.accounts,
      TAX_YEAR,
      state.details,
      payerDetails(state),
    );
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
    // The names last: nothing in a reply can rename a download.
    return {
      kdvp: { ...prepared.kdvp, fileName: formFileName("kdvp", TAX_YEAR) },
      div: { ...prepared.div, fileName: formFileName("div", TAX_YEAR) },
    };
  }, [prepared]);

  // Entering the demo starts the tour, the first time in this page session.
  const enterDemo = (action: "startDemo" | "useDemoFiles") => {
    // A new screen opens at its top; that is where the tour gives it back.
    if (!tour.seen) {
      restore.current = { ...noRestore("heading"), scrollY: 0 };
    }
    dispatch({ type: action });
    tourDispatch({ type: "start" });
  };
  const startDemo = () => {
    enterDemo("startDemo");
  };
  const replayTour = () => {
    // Taken before the tour shows a shorter screen, which clamps the scroll.
    restore.current = { ...noRestore("tourButton"), scrollY: window.scrollY };
    tourDispatch({ type: "replay" });
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
    <div
      className={cx("app", tourRun !== null && "is-touring")}
      data-theme={theme}
    >
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
              state={shown}
              onGoTo={(screen) => {
                dispatch({ type: "goTo", screen });
              }}
            />
            {state.mode === "demo" ? <DemoBanner onTour={replayTour} /> : null}
            <ErrorBoundary
              resetKey={shownScreen}
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
              {shownScreen === "files" ? (
                <FilesStep
                  state={shown}
                  taxYear={TAX_YEAR}
                  onAddFiles={addFiles}
                  onRemoveFile={(id) => {
                    dispatch({ type: "removeFile", id });
                  }}
                  onSetAccounts={(choice) => {
                    dispatch({ type: "setAccounts", accounts: choice });
                  }}
                  onUseDemoFiles={() => {
                    enterDemo("useDemoFiles");
                  }}
                  onBack={back}
                  onNext={next}
                />
              ) : null}
              {shownScreen === "details" ? (
                <DetailsStep
                  state={shown}
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
              {shownScreen === "review" ? (
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
                  view={shownReview}
                  // The tour's view is its own: a toggle it causes is not the user's.
                  onViewChange={stop === undefined ? setReviewView : noChange}
                  onBack={back}
                  onNext={next}
                  onStartDemo={startDemo}
                />
              ) : null}
              {shownScreen === "download" ? (
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
      {tourRun === null || stop === undefined ? null : (
        // A failure in the tour closes it and gives the page back, rather
        // than taking the app down with it.
        <ErrorBoundary
          resetKey={tourRun.stop}
          fallback={null}
          onError={() => {
            restorePending.current = true;
            tourDispatch({ type: "exit" });
          }}
        >
          <TourLayer
            run={tourRun}
            preview={demoPreview}
            restore={restore.current}
            onNext={(capacity) => {
              tourDispatch({ type: "next", capacity });
            }}
            onBack={(capacity) => {
              tourDispatch({ type: "back", capacity });
            }}
            onClosed={() => {
              restorePending.current = true;
              tourDispatch({ type: "exit" });
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

const noChange = () => undefined;

export function App({
  initialLocale = "sl",
  initialState = initialWizardState,
  initialTheme = "dark",
  initialTour = initialTourState,
  engine,
}: {
  readonly initialLocale?: Locale;
  /** Lets tests render any screen without simulating clicks. */
  readonly initialState?: WizardState;
  readonly initialTheme?: Theme;
  /** Lets tests render a tour stop, or a tour already seen. */
  readonly initialTour?: TourState;
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
        initialTour={initialTour}
        engine={running}
      />
    </I18nProvider>
  );
}
