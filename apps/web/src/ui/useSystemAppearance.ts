/**
 * Follows the operating system's light or dark setting, live. There is no
 * in-app toggle: both themes carry the same hierarchy, so the system choice
 * loses nothing.
 */
import { useSyncExternalStore } from "react";

export type Appearance = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

function getSnapshot(): Appearance {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

/** Server rendering and tests have no media queries: start light. */
function getServerSnapshot(): Appearance {
  return "light";
}

export function useSystemAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
