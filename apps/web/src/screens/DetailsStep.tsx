/**
 * Taxpayer details for the XML header. Labels sit above their inputs, help and
 * error text below, and an error is tied to its input with aria-describedby.
 * It is a real form, so Enter submits; a failed submit moves focus to the
 * field, which then announces its error through that description.
 */
import {
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  LockSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useRef, type Ref } from "react";

import { useI18n } from "../i18n/i18n";
import {
  isValidTaxNumber,
  normalizeTaxNumber,
  type Details,
  type WizardState,
} from "../state/wizard";
import { Button, cx } from "../ui/kit";

function Field({
  id,
  label,
  value,
  onChange,
  help,
  error,
  inputMode,
  autoComplete,
  maxLength,
  required = false,
  wide = false,
  inputRef,
}: {
  readonly id: keyof Details;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly help?: string;
  readonly error?: string | null;
  readonly inputMode?: "text" | "numeric" | "email";
  readonly autoComplete: string;
  readonly maxLength?: number;
  readonly required?: boolean;
  /** Spans both columns of the form grid. */
  readonly wide?: boolean;
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  const inputId = `details-${id}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [
    help === undefined ? null : helpId,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cx("field", wide && "span-2")}>
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className={cx("input", error && "is-invalid")}
        aria-required={required || undefined}
        value={value}
        inputMode={inputMode ?? "text"}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
      {help === undefined ? null : (
        <p id={helpId} className="field-help">
          {help}
        </p>
      )}
      {/* role="alert": pressing Enter in the field leaves focus where it
          is, so the error has to announce itself. */}
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          <WarningCircleIcon size={16} weight="bold" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The taxpayer block of the XML header as the user types, in the order the
 * writer emits it; empty optional fields are left out, as they will be in the
 * file. A visual aid that repeats the form, so hidden from screen readers.
 * One block per element with a hanging indent, so a long value wraps under
 * itself instead of breaking the layout.
 */
function HeaderPreview({ details }: { readonly details: Details }) {
  const rows: readonly (readonly [string, string])[] = [
    ["edp:taxNumber", normalizeTaxNumber(details.taxNumber)],
    ["edp:taxpayerType", "FO"],
    ["edp:name", details.name.trim()],
    ["edp:address1", details.address.trim()],
    ["edp:city", details.city.trim()],
    ["edp:postNumber", details.postCode.trim()],
  ];
  return (
    <pre className="xml-preview">
      <code>
        <span className="xml-line xml-tag">{"<edp:taxpayer>"}</span>
        {rows.map(([tag, value]) =>
          value === "" && tag !== "edp:taxNumber" ? null : (
            <span key={tag} className="xml-line xml-child">
              <span className="xml-tag">{`<${tag}>`}</span>
              <wbr />
              {value === "" ? (
                <span className="xml-empty">{"········"}</span>
              ) : (
                <span className="xml-value">{value}</span>
              )}
              <wbr />
              <span className="xml-tag">{`</${tag}>`}</span>
            </span>
          ),
        )}
        <span className="xml-line xml-tag">{"</edp:taxpayer>"}</span>
      </code>
    </pre>
  );
}

export function DetailsStep({
  state,
  onChange,
  onBack,
  onNext,
}: {
  readonly state: WizardState;
  readonly onChange: (field: keyof Details, value: string) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  const { t } = useI18n();
  const { details } = state;
  const taxNumberField = useRef<HTMLInputElement>(null);
  const taxNumberRequired = state.mode === "own";
  const taxNumberError =
    state.showErrors &&
    state.mode === "own" &&
    !isValidTaxNumber(details.taxNumber)
      ? t.details.taxNumberError
      : null;
  const set = (field: keyof Details) => (value: string) => {
    onChange(field, value);
  };
  function submit(): void {
    if (taxNumberRequired && !isValidTaxNumber(details.taxNumber)) {
      taxNumberField.current?.focus();
    }
    onNext();
  }
  return (
    <form
      noValidate
      className="screen"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <header className="screen-head">
        <h1 tabIndex={-1}>{t.details.title}</h1>
        <p className="lead">{t.details.intro}</p>
        <p className="strong small">
          {state.mode === "demo" ? t.details.demoNote : t.details.requiredNote}
        </p>
      </header>

      <div className="details-layout">
        <div className="card form-card">
          <div className="form-grid">
            <Field
              id="taxNumber"
              label={
                taxNumberRequired
                  ? `${t.details.taxNumberLabel} ${t.details.requiredSuffix}`
                  : t.details.taxNumberLabel
              }
              required={taxNumberRequired}
              inputRef={taxNumberField}
              value={details.taxNumber}
              onChange={set("taxNumber")}
              help={t.details.taxNumberHelp}
              error={taxNumberError}
              inputMode="numeric"
              autoComplete="off"
              maxLength={9}
            />
            <Field
              id="name"
              label={t.details.nameLabel}
              value={details.name}
              onChange={set("name")}
              autoComplete="name"
            />
            <Field
              id="address"
              label={t.details.addressLabel}
              value={details.address}
              onChange={set("address")}
              autoComplete="street-address"
              wide
            />
            <Field
              id="postCode"
              label={t.details.postCodeLabel}
              value={details.postCode}
              onChange={set("postCode")}
              inputMode="numeric"
              autoComplete="postal-code"
            />
            <Field
              id="city"
              label={t.details.cityLabel}
              value={details.city}
              onChange={set("city")}
              autoComplete="address-level2"
            />
            <Field
              id="email"
              label={t.details.emailLabel}
              value={details.email}
              onChange={set("email")}
              help={t.details.emailHelp}
              inputMode="email"
              autoComplete="email"
              wide
            />
          </div>
        </div>

        <div className="details-actions">
          <p className="with-icon muted small">
            <InfoIcon size={16} weight="bold" aria-hidden />
            {t.details.residentNote}
          </p>
          <div className="actions-row">
            <Button size="lg" onClick={onBack}>
              {t.nav.back}
            </Button>
            <Button variant="primary" size="lg" type="submit">
              {t.details.next}
              <ArrowRightIcon size={18} weight="bold" aria-hidden />
            </Button>
          </div>
        </div>

        {/* After the buttons in the DOM, so keyboard order stays form then
          actions; on a wide screen it sits beside the form. */}
        <aside className="details-aside" aria-labelledby="details-aside-title">
          <div className="card aside-card">
            <span className="icon-tile icon-tile-sm" aria-hidden>
              <LockSimpleIcon size={20} weight="bold" />
            </span>
            <h2 id="details-aside-title">{t.details.asideTitle}</h2>
            <ul className="check-list" role="list">
              {t.details.asidePoints.map((point) => (
                <li key={point}>
                  <CheckIcon size={14} weight="bold" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="card aside-card" aria-hidden>
            <h2 className="aside-label">{t.details.previewTitle}</h2>
            <p className="muted small">{t.details.previewBody}</p>
            <HeaderPreview details={details} />
          </div>
        </aside>
      </div>
    </form>
  );
}
