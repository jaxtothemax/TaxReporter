/** Browser entry (index.html): loads the styles and mounts the app into #root. */
// Fonts are self-hosted: the app never asks a third party for anything.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
// Radix Themes, imported granularly: only the color scales the app uses.
import "@radix-ui/themes/tokens/base.css";
import "@radix-ui/themes/tokens/colors/sage.css";
import "@radix-ui/themes/tokens/colors/jade.css";
import "@radix-ui/themes/tokens/colors/amber.css";
import "@radix-ui/themes/tokens/colors/red.css";
import "@radix-ui/themes/components.css";
import "@radix-ui/themes/utilities.css";
import "./styles.css";

import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { detectLocale } from "./i18n/i18n";

const container = document.getElementById("root");
if (container === null) {
  throw new Error(
    'TaxReporter: index.html has no <div id="root"> to mount into',
  );
}
const languages = typeof navigator === "undefined" ? [] : navigator.languages;
createRoot(container).render(
  createElement(
    StrictMode,
    null,
    createElement(App, { initialLocale: detectLocale(languages) }),
  ),
);
