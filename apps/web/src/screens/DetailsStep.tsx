/**
 * Taxpayer details for the XML header, and the details Doh-Div needs of each
 * dividend payer (ADR 0013 §8). Labels sit above their inputs, help and
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
import { FURS_COUNTRIES } from "@taxreporter/furs";
import { useMemo, useRef, type Ref } from "react";

import type { PayerPrompt } from "../engine/protocol";
import { explain, type ExplainProps } from "../explain/anchors";
import { formatCountry, plural, type Locale } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import {
  brokerPayerOf,
  isPayerIncomplete,
  isValidTaxNumber,
  normalizeTaxNumber,
  type Details,
  type PayerDraft,
  type WizardState,
} from "../state/wizard";
import { Button, cx, Note } from "../ui/kit";

function Field({
  inputId,
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
  explainAs,
}: {
  readonly inputId: string;
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
  /** Marks the field for an explanation (explain/anchors.ts). */
  readonly explainAs?: ExplainProps;
}) {
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [
    help === undefined ? null : helpId,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cx("field", wide && "span-2")} {...explainAs}>
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
 * The longest text the XML takes in an element (furs/common.ts,
 * MAX_TEXT_LENGTH) and in the post code, which its schema caps at 12. A
 * field cannot take more than its element, so a long value never reaches
 * the writer to be refused there.
 */
const TEXT_LIMIT = 255;
const POST_CODE_LIMIT = 12;

/** FURS writes Greece as EL; the display names know it as GR. */
const countryName = (code: string, locale: Locale) =>
  formatCountry(code === "EL" ? "GR" : code, locale);

/** The FURS country list, by name in the UI language. */
function useCountries(): readonly (readonly [string, string])[] {
  const { locale } = useI18n();
  return useMemo(
    () =>
      FURS_COUNTRIES.map((code) => [code, countryName(code, locale)] as const)
        .slice()
        .sort(([, a], [, b]) => a.localeCompare(b, locale)),
    [locale],
  );
}

function CountrySelect({
  inputId,
  label,
  value,
  onChange,
  help,
}: {
  readonly inputId: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly help?: string;
}) {
  const { t } = useI18n();
  const countries = useCountries();
  const helpId = `${inputId}-help`;
  return (
    <div className="field">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <select
        id={inputId}
        className="input"
        value={value}
        aria-describedby={help === undefined ? undefined : helpId}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      >
        <option value="">{t.details.countryChoose}</option>
        {countries.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      {help === undefined ? null : (
        <p id={helpId} className="field-help">
          {help}
        </p>
      )}
    </div>
  );
}

/** One payer's details, under the security that paid. */
function PayerFields({
  prompt,
  draft,
  onChange,
}: {
  readonly prompt: PayerPrompt;
  readonly draft: PayerDraft;
  readonly onChange: (field: keyof PayerDraft, value: string) => void;
}) {
  const { locale, t } = useI18n();
  const id = (field: keyof PayerDraft) => `payer-${prompt.isin}-${field}`;
  const set = (field: keyof PayerDraft) => (value: string) => {
    onChange(field, value);
  };
  const title = prompt.symbol === "" ? prompt.isin : prompt.symbol;
  return (
    <fieldset className="payer-fields">
      <legend className="payer-legend">
        <span className="strong">{title}</span>{" "}
        <span className="mono muted small">{prompt.isin}</span>{" "}
        <span className="muted small">
          {plural(prompt.payments, locale, t.details.payments)}
        </span>
      </legend>
      <div className="form-grid">
        <Field
          inputId={id("name")}
          label={t.details.payerName}
          value={draft.name}
          onChange={set("name")}
          autoComplete="off"
          maxLength={TEXT_LIMIT}
          wide
        />
        <Field
          inputId={id("address")}
          label={t.details.payerAddress}
          value={draft.address}
          onChange={set("address")}
          autoComplete="off"
          maxLength={TEXT_LIMIT}
          wide
        />
        <CountrySelect
          inputId={id("country")}
          label={t.details.payerCountry}
          value={draft.country}
          onChange={set("country")}
        />
        {draft.country === "SI" ? (
          <Field
            inputId={id("id")}
            label={t.details.payerTaxNumber}
            value={draft.id}
            onChange={set("id")}
            help={t.details.payerTaxNumberHelp}
            inputMode="numeric"
            autoComplete="off"
            maxLength={9}
          />
        ) : (
          <Field
            inputId={id("id")}
            label={t.details.payerId}
            value={draft.id}
            onChange={set("id")}
            help={t.details.payerIdHelp}
            autoComplete="off"
            maxLength={TEXT_LIMIT}
          />
        )}
        {prompt.isinCountry === "" ? (
          <CountrySelect
            inputId={id("sourceCountry")}
            label={t.details.sourceCountry}
            value={draft.sourceCountry}
            onChange={set("sourceCountry")}
            help={t.details.sourceCountryHelp}
          />
        ) : null}
      </div>
    </fieldset>
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
  onPayerChange,
  onBack,
  onNext,
}: {
  readonly state: WizardState;
  readonly onChange: (field: keyof Details, value: string) => void;
  readonly onPayerChange: (
    isin: string,
    field: keyof PayerDraft,
    value: string,
  ) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  const { locale, t } = useI18n();
  const prompts =
    state.mode === "own" && state.reading.status === "read"
      ? state.reading.reply.payers
      : [];
  // Each broker whose payer details were preset, named once.
  const presetBrokers = [
    ...new Set(
      prompts.flatMap((p) => {
        const preset = brokerPayerOf(p);
        return preset === undefined ? [] : [preset.name];
      }),
    ),
  ];
  const missing = prompts.filter((p) =>
    isPayerIncomplete(state.payers[p.isin], p.isinCountry),
  ).length;
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
        <div className="details-forms">
          <div className="card form-card" {...explain("details.form")}>
            <div className="form-grid">
              <Field
                inputId="details-taxNumber"
                explainAs={explain("details.taxNumber")}
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
                inputId="details-name"
                label={t.details.nameLabel}
                value={details.name}
                onChange={set("name")}
                autoComplete="name"
                maxLength={TEXT_LIMIT}
              />
              <Field
                inputId="details-address"
                label={t.details.addressLabel}
                value={details.address}
                onChange={set("address")}
                autoComplete="street-address"
                maxLength={TEXT_LIMIT}
                wide
              />
              <Field
                inputId="details-postCode"
                label={t.details.postCodeLabel}
                value={details.postCode}
                onChange={set("postCode")}
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={POST_CODE_LIMIT}
              />
              <Field
                inputId="details-city"
                label={t.details.cityLabel}
                value={details.city}
                onChange={set("city")}
                autoComplete="address-level2"
                maxLength={TEXT_LIMIT}
              />
              <Field
                inputId="details-email"
                label={t.details.emailLabel}
                value={details.email}
                onChange={set("email")}
                help={t.details.emailHelp}
                inputMode="email"
                autoComplete="email"
                maxLength={TEXT_LIMIT}
                wide
              />
            </div>
          </div>

          {prompts.length === 0 ? null : (
            <section
              className="card form-card payers-card"
              aria-labelledby="payers-title"
            >
              <h2 id="payers-title" className="payers-title">
                {t.details.payersTitle}
              </h2>
              <p className="muted small">{t.details.payersIntro}</p>
              {presetBrokers.length === 0 ? null : (
                <p className="muted small">
                  {t.details.payerFromBroker(presetBrokers.join(", "))}
                </p>
              )}
              {missing === 0 ? null : (
                <Note tone="warn">
                  {plural(missing, locale, t.details.payersMissing)}
                </Note>
              )}
              {prompts.map((prompt) => {
                const draft = state.payers[prompt.isin];
                return draft === undefined ? null : (
                  <PayerFields
                    key={prompt.isin}
                    prompt={prompt}
                    draft={draft}
                    onChange={(field, value) => {
                      onPayerChange(prompt.isin, field, value);
                    }}
                  />
                );
              })}
            </section>
          )}
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
