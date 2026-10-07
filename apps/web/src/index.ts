/** Browser entry (index.html): mounts the app into #root. */
import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

const container = document.getElementById("root");
if (container === null) {
  throw new Error(
    'TaxReporter: index.html has no <div id="root"> to mount into',
  );
}
createRoot(container).render(
  createElement(StrictMode, null, createElement(App)),
);
