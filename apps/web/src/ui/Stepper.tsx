/**
 * Where the user is in the flow. Steps are named by what happens in them;
 * reachable earlier steps are buttons, the current one is marked with
 * aria-current="step" for screen readers. The numbers are decoration.
 */
import { CheckIcon } from "@phosphor-icons/react";

import { formatNumber } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import {
  canEnter,
  FLOW_STEPS,
  type FlowStep,
  type WizardState,
} from "../state/wizard";
import { cx } from "./kit";

export function Stepper({
  state,
  onGoTo,
}: {
  readonly state: WizardState;
  readonly onGoTo: (step: FlowStep) => void;
}) {
  const { locale, t } = useI18n();
  const current =
    state.screen === "start" ? -1 : FLOW_STEPS.indexOf(state.screen);
  return (
    <nav aria-label={t.stepper.label} className="stepper">
      <ol role="list">
        {FLOW_STEPS.map((step, index) => {
          const isCurrent = index === current;
          const isDone = index < current;
          const marker = (
            <span className="step-marker" aria-hidden>
              {isDone ? (
                <CheckIcon size={12} weight="bold" />
              ) : (
                formatNumber(String(index + 1), locale)
              )}
            </span>
          );
          const label = <span className="step-label">{t.stepper[step]}</span>;
          return (
            <li
              key={step}
              className={cx(
                "step",
                isCurrent && "is-current",
                isDone && "is-done",
              )}
            >
              {isCurrent ? (
                <span aria-current="step" className="step-item">
                  {marker}
                  {label}
                </span>
              ) : canEnter(state, step) ? (
                <button
                  type="button"
                  className="step-item"
                  onClick={() => {
                    onGoTo(step);
                  }}
                >
                  {marker}
                  {label}
                  {isDone ? (
                    <span className="visually-hidden">, {t.stepper.done}</span>
                  ) : null}
                </button>
              ) : (
                <span className="step-item">
                  {marker}
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
