/**
 * Calendar dates as the ledger and both forms carry them: ISO 8601
 * "YYYY-MM-DD". One check for the whole project, so that a date one package
 * accepts no other refuses.
 */

/** An ISO 8601 calendar date, "2026-03-12". */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar date written as YYYY-MM-DD, from the year 1000: the only
 * form xs:date takes in the FURS forms. Anything that is not a string is
 * refused, not coerced, since a model can come from JSON.
 */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1000 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
