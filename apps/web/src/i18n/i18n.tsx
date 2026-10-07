/**
 * The active UI language and its messages, provided once at the app root.
 *
 * The choice lives in memory only: it is not personal data, but persisting it
 * would be the app's only use of browser storage, and "nothing is stored" is a
 * simpler promise to keep (ADR 0002).
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Locale } from "./format";
import { MESSAGES, type Messages } from "./messages";

export interface I18n {
  readonly locale: Locale;
  readonly t: Messages;
  readonly setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18n | null>(null);

/** Slovenian for anyone whose browser prefers it, English otherwise. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((tag) => tag.toLowerCase().startsWith("sl"))
    ? "sl"
    : "en";
}

export function I18nProvider({
  initialLocale,
  children,
}: {
  readonly initialLocale: Locale;
  readonly children: ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo<I18n>(
    () => ({ locale, t: MESSAGES[locale], setLocale }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error("useI18n() needs an <I18nProvider> above it");
  }
  return value;
}
