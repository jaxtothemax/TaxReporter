/** Browser entry (index.html): loads the styles and mounts the app into #root. */
// Fonts are self-hosted: the app never asks a third party for anything.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
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
