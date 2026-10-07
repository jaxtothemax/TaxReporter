/**
 * The app root: theme, language, and the flow from the start screen to the
 * download. All state lives in memory; nothing is stored or sent anywhere.
 */
import { Container, Flex, Section, Theme } from "@radix-ui/themes";
import { useEffect, useReducer, useRef } from "react";

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
import { AppFooter, AppHeader, Main, SkipLink } from "./ui/AppChrome";
import { DemoBanner } from "./ui/bits";
import { Stepper } from "./ui/Stepper";
import { useSystemAppearance } from "./ui/useSystemAppearance";

function Frame({ initialState }: { readonly initialState: WizardState }) {
  const appearance = useSystemAppearance();
  const { locale, t } = useI18n();
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const firstRender = useRef(true);
  const preview = state.mode === "demo" ? demoPreview : null;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
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
    <Theme
      appearance={appearance}
      accentColor="jade"
      grayColor="sage"
      radius="medium"
      panelBackground="solid"
    >
      <SkipLink />
      <AppHeader
        onHome={() => {
          dispatch({ type: "restart" });
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
          <Section size="2">
            <Container size="4" px={{ initial: "4", md: "6" }}>
              <Flex direction="column" gap="6">
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
              </Flex>
            </Container>
          </Section>
        )}
      </Main>
      <AppFooter />
    </Theme>
  );
}

export function App({
  initialLocale = "sl",
  initialState = initialWizardState,
}: {
  readonly initialLocale?: Locale;
  /** Lets tests render any screen without simulating clicks. */
  readonly initialState?: WizardState;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <Frame initialState={initialState} />
    </I18nProvider>
  );
}
