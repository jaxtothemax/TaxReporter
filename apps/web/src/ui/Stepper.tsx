/**
 * Where the user is in the flow. Steps are named by what happens in them, not
 * numbered; reachable earlier steps are buttons, the current one is marked
 * with aria-current="step" for screen readers.
 */
import { CheckCircleIcon } from "@phosphor-icons/react";
import { Text } from "@radix-ui/themes";

import { useI18n } from "../i18n/i18n";
import {
  canEnter,
  FLOW_STEPS,
  type FlowStep,
  type WizardState,
} from "../state/wizard";

export function Stepper({
  state,
  onGoTo,
}: {
  readonly state: WizardState;
  readonly onGoTo: (step: FlowStep) => void;
}) {
  const { t } = useI18n();
  const current =
    state.screen === "start" ? -1 : FLOW_STEPS.indexOf(state.screen);
  return (
    <nav aria-label={t.stepper.label} className="stepper">
      <ol role="list">
        {FLOW_STEPS.map((step, index) => {
          const isCurrent = index === current;
          const isDone = index < current;
          const label = t.stepper[step];
          return (
            <li key={step} className={isCurrent ? "is-current" : undefined}>
              {isCurrent ? (
                <span aria-current="step" className="stepper-item">
                  <Text weight="bold">{label}</Text>
                </span>
              ) : canEnter(state, step) ? (
                <button
                  type="button"
                  className="stepper-item"
                  onClick={() => {
                    onGoTo(step);
                  }}
                >
                  {isDone ? (
                    <CheckCircleIcon
                      size={16}
                      weight="fill"
                      aria-hidden
                      className="accent-icon"
                    />
                  ) : null}
                  <Text color={isDone ? undefined : "gray"}>{label}</Text>
                  {isDone ? (
                    <span className="visually-hidden">, {t.stepper.done}</span>
                  ) : null}
                </button>
              ) : (
                <span className="stepper-item">
                  <Text color="gray">{label}</Text>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
