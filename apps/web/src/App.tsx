/**
 * The app root: theme, language, and the flow from the start screen to the
 * download. All state lives in memory; nothing is stored or sent anywhere.
 */
import { useEffect, useReducer, useRef, useState } from "react";

import { demoPreview } from "./demo/demoPreview";
import type { Locale } from "./i18n/format";
import { I18nProvider, useI18n } from "./i18n/i18n";
import { DetailsStep } from "./screens/DetailsStep";
import { DownloadStep } from "./screens/DownloadStep";
import { FilesStep } from "./screens/FilesStep";
import { EmptyReview, ReviewStep } from "./screens/ReviewStep";
import { StartScreen } from "./screens/StartScreen";
import {
  initialWizardState,
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
import { Stepper } from "./ui/Stepper";

function Frame({
  initialState,
  initialTheme,
}: {
  readonly initialState: WizardState;
  readonly initialTheme: Theme;
}) {
  const { locale, t } = useI18n();
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const previousScreen = useRef(state.screen);
  const preview = state.mode === "demo" ? demoPreview : null;

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

  const startDemo = () => {
    dispatch({ type: "startDemo" });
  };
  const back = () => {
    dispatch({ type: "back" });
  };
  const next = () => {
    dispatch({ type: "next" });
  };

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
            {state.screen === "files" ? (
              <FilesStep
                state={state}
                taxYear={TAX_YEAR}
                onAddFiles={(files) => {
                  dispatch({ type: "addFiles", files });
                }}
                onRemoveFile={(id) => {
                  dispatch({ type: "removeFile", id });
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
                onBack={back}
                onNext={next}
              />
            ) : null}
            {state.screen === "review" ? (
              <ReviewStep
                preview={preview}
                onBack={back}
                onNext={next}
                onStartDemo={startDemo}
              />
            ) : null}
            {state.screen === "download" ? (
              preview === null ? (
                // Unreachable through the flow (own files block at the
                // review), but never render a blank screen.
                <EmptyReview onStartDemo={startDemo} />
              ) : (
                <DownloadStep
                  preview={preview}
                  onBack={back}
                  onRestart={() => {
                    dispatch({ type: "restart" });
                  }}
                />
              )
            ) : null}
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
}: {
  readonly initialLocale?: Locale;
  /** Lets tests render any screen without simulating clicks. */
  readonly initialState?: WizardState;
  readonly initialTheme?: Theme;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <Frame initialState={initialState} initialTheme={initialTheme} />
    </I18nProvider>
  );
}
