/** Header, footer and skip link: the frame around every screen. */
import {
  ArrowUpRightIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { LOCALES } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import { IconButton } from "./kit";

/**
 * Where "Source code" points. The repository is not public yet, so the build
 * can set VITE_SOURCE_URL; the fallback is the planned GitHub location.
 */
export const SOURCE_URL: string =
  (import.meta.env as Record<string, string | undefined>)["VITE_SOURCE_URL"] ??
  "https://github.com/jaxtothemax/TaxReporter";

/** Dark first; light is one click away. Held in memory like the language. */
export type Theme = "dark" | "light";

/**
 * The language switch as native radio buttons: arrow keys move between them
 * without any script, and each visible code ("SL") is followed by the
 * language's own name in its own language for screen readers.
 */
function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <fieldset className="segmented segmented-sm">
      <legend className="visually-hidden">{t.app.languageLabel}</legend>
      {LOCALES.map((code) => (
        <label key={code} className="segment">
          <input
            type="radio"
            name="ui-language"
            value={code}
            checked={locale === code}
            onChange={() => {
              setLocale(code);
            }}
          />
          <span>{code.toUpperCase()}</span>
          <span className="visually-hidden" lang={code}>
            {" "}
            {t.app.languageNames[code]}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function AppHeader({
  onHome,
  theme,
  onToggleTheme,
}: {
  readonly onHome: () => void;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="app-header">
      <div className="container app-header-row">
        <button
          type="button"
          className="brand"
          onClick={onHome}
          aria-label={t.app.homeLink}
        >
          <span className="brand-mark" aria-hidden>
            <span />
          </span>
          <span className="brand-name">{t.app.name}</span>
        </button>
        <div className="header-tools">
          <span className="privacy-pill">
            <ShieldCheckIcon size={15} weight="bold" aria-hidden />
            {t.app.privacyBadge}
          </span>
          <LanguageSwitch />
          <IconButton
            label={t.app.themeLight}
            aria-pressed={theme === "light"}
            onClick={onToggleTheme}
          >
            {theme === "light" ? (
              <MoonIcon size={18} weight="bold" aria-hidden />
            ) : (
              <SunIcon size={18} weight="bold" aria-hidden />
            )}
          </IconButton>
        </div>
      </div>
    </header>
  );
}

export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="app-footer">
      <div className="container app-footer-row">
        <p className="footer-note">{t.app.footerNotAdvice}</p>
        <div className="footer-links">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            {t.app.footerSource}
            <ArrowUpRightIcon size={14} weight="bold" aria-hidden />
            <span className="visually-hidden"> {t.app.opensInNewTab}</span>
          </a>
          <p>{t.app.footerRates}</p>
        </div>
      </div>
    </footer>
  );
}

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a className="skip-link" href="#main">
      {t.app.skipToContent}
    </a>
  );
}

export function Main({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="app-main">
      {children}
    </main>
  );
}
