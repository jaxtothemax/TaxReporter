/**
 * Security identifiers. FIFO, the 30-day rule and both forms key on the
 * ISIN (ISO 6166), so the engine checks it where events come in, adapters
 * where rows are read, and the Doh-KDVP validator again before writing.
 */

/** ISO 6166: two letters, nine alphanumerics, a Luhn check digit. */
export function isIsin(value: unknown): boolean {
  if (typeof value !== "string" || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value)) {
    return false;
  }
  // Letters count as two digits (A = 10 ... Z = 35); the pattern above has
  // already made the string ASCII.
  let digits = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    digits += code >= 65 ? String(code - 55) : value.charAt(i);
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
