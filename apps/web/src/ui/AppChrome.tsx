/** Header, footer and skip link: the frame around every screen. */
import { ShieldCheckIcon } from "@phosphor-icons/react";
import {
  Container,
  Flex,
  Link,
  SegmentedControl,
  Separator,
  Text,
} from "@radix-ui/themes";
import type { ReactNode } from "react";

import { LOCALES, type Locale } from "../i18n/format";
import { useI18n } from "../i18n/i18n";

/**
 * Where "Source code" points. The repository is not public yet, so the build
 * can set VITE_SOURCE_URL; the fallback is the planned GitHub location.
 */
export const SOURCE_URL: string =
  (import.meta.env as Record<string, string | undefined>)["VITE_SOURCE_URL"] ??
  "https://github.com/jaxtothemax/TaxReporter";

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function AppHeader({ onHome }: { readonly onHome: () => void }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <header className="app-header">
      <Container size="4" px={{ initial: "4", md: "6" }}>
        <Flex
          align="center"
          justify="between"
          gap="4"
          className="app-header-row"
        >
          <button
            type="button"
            className="brand"
            onClick={onHome}
            aria-label={t.app.homeLink}
          >
            <span className="brand-mark" aria-hidden>
              TR
            </span>
            <Text size="4" weight="bold" className="brand-name">
              {t.app.name}
            </Text>
          </button>
          <Flex align="center" gap="4">
            <Flex
              align="center"
              gap="2"
              display={{ initial: "none", sm: "flex" }}
            >
              <ShieldCheckIcon
                size={18}
                weight="bold"
                aria-hidden
                className="accent-icon"
              />
              <Text size="2" color="gray">
                {t.app.privacyBadge}
              </Text>
            </Flex>
            <SegmentedControl.Root
              size="1"
              value={locale}
              aria-label={t.app.languageLabel}
              onValueChange={(value) => {
                if (isLocale(value)) setLocale(value);
              }}
            >
              {LOCALES.map((code) => (
                <SegmentedControl.Item
                  key={code}
                  value={code}
                  aria-label={t.app.languageNames[code]}
                >
                  {code.toUpperCase()}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </Flex>
        </Flex>
      </Container>
    </header>
  );
}

export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="app-footer">
      <Container size="4" px={{ initial: "4", md: "6" }}>
        <Separator size="4" mb="5" />
        <Flex
          direction={{ initial: "column", md: "row" }}
          gap={{ initial: "3", md: "6" }}
          justify="between"
        >
          <Text size="2" color="gray" className="footer-note">
            {t.app.footerNotAdvice}
          </Text>
          <Flex
            direction="column"
            gap="1"
            align={{ initial: "start", md: "end" }}
          >
            <Link size="2" href={SOURCE_URL} target="_blank" rel="noreferrer">
              {t.app.footerSource}
              <span className="visually-hidden"> {t.app.opensInNewTab}</span>
            </Link>
            <Text size="2" color="gray">
              {t.app.footerRates}
            </Text>
          </Flex>
        </Flex>
      </Container>
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
