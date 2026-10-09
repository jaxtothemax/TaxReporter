/**
 * A screen that throws while it renders shows a fixed message in its place
 * instead of a blank page. Nothing about the error is shown: its message
 * could hold text from the user's files (CLAUDE.md, "Privacy"). The flow's
 * state lives above the boundary and survives it; a new screen (a changed
 * `resetKey`) tries again.
 */
import { Component, type ReactNode } from "react";

interface Props {
  /** What to show instead of the screen that failed. */
  readonly fallback: ReactNode;
  /** When this changes, the boundary renders its children again. */
  readonly resetKey: unknown;
  /** Told when a child failed, e.g. to close what the child was showing. */
  readonly onError?: () => void;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
  readonly key: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    // Another screen: whatever failed on the last one does not stand here.
    return Object.is(props.resetKey, state.key)
      ? null
      : { failed: false, key: props.resetKey };
  }

  override componentDidCatch(): void {
    this.props.onError?.();
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
