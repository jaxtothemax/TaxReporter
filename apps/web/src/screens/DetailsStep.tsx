/**
 * Taxpayer details for the XML header. Labels sit above their inputs, help and
 * error text below, and an error is tied to its input with aria-describedby.
 */
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";

import { useI18n } from "../i18n/i18n";
import {
  isValidTaxNumber,
  type Details,
  type WizardState,
} from "../state/wizard";

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
    <Flex direction="column" gap="1">
      <Text as="label" htmlFor={inputId} size="2" weight="medium">
        {label}
      </Text>
      <TextField.Root
        id={inputId}
        size="3"
        value={value}
        inputMode={inputMode ?? "text"}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        color={error ? "red" : undefined}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
      {help === undefined ? null : (
        <Text id={helpId} size="1" color="gray">
          {help}
        </Text>
      )}
      {error ? (
        <Text id={errorId} size="2" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
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
  const taxNumberError =
    state.showErrors &&
    state.mode === "own" &&
    !isValidTaxNumber(details.taxNumber)
      ? t.details.taxNumberError
      : null;
  const set = (field: keyof Details) => (value: string) => {
    onChange(field, value);
  };
  return (
    <Flex direction="column" gap="6">
      <Box className="measure">
        <Heading as="h1" size="7" mb="2" tabIndex={-1}>
          {t.details.title}
        </Heading>
        <Text as="p" size="3" color="gray">
          {t.details.intro}
        </Text>
        {state.mode === "demo" ? (
          <Text as="p" size="2" weight="medium" mt="2">
            {t.details.demoNote}
          </Text>
        ) : null}
      </Box>

      <Grid columns={{ initial: "1", sm: "2" }} gap="5" className="form-grid">
        <Field
          id="taxNumber"
          label={t.details.taxNumberLabel}
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
        <Box gridColumn={{ initial: "1", sm: "1 / -1" }}>
          <Field
            id="address"
            label={t.details.addressLabel}
            value={details.address}
            onChange={set("address")}
            autoComplete="street-address"
          />
        </Box>
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
        />
      </Grid>

      <Text as="p" size="2" color="gray">
        {t.details.residentNote}
      </Text>

      <Flex gap="3">
        <Button size="3" variant="soft" color="gray" onClick={onBack}>
          {t.nav.back}
        </Button>
        <Button size="3" onClick={onNext}>
          {t.details.next}
        </Button>
      </Flex>
    </Flex>
  );
}
