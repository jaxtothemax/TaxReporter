/**
 * The boundary's logic, without a DOM: server rendering does not run error
 * boundaries, so the class's own steps are checked directly.
 */
import { describe, expect, it } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

const props = (resetKey: unknown) => ({
  fallback: "fallback",
  resetKey,
  children: "screen",
});

describe("ErrorBoundary", () => {
  it("shows its fallback, and nothing of the error, once a screen throws", () => {
    const boundary = new ErrorBoundary(props("review"));
    expect(boundary.render()).toBe("screen");
    boundary.state = {
      ...boundary.state,
      ...ErrorBoundary.getDerivedStateFromError(),
    };
    expect(boundary.render()).toBe("fallback");
  });

  it("tries again on another screen, and not before", () => {
    const failed = { failed: true, key: "review" };
    expect(
      ErrorBoundary.getDerivedStateFromProps(props("review"), failed),
    ).toBeNull();
    expect(
      ErrorBoundary.getDerivedStateFromProps(props("download"), failed),
    ).toEqual({ failed: false, key: "download" });
  });
});
