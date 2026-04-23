/**
 * Format a US phone number to the canonical "(XXX) XXX-XXXX" form.
 *
 * Accepts any input ("3213332587", "321-333-2587", "+1 321 333 2587", etc.)
 * and returns the formatted string when the digits resolve to a valid
 * 10-digit US number. Returns `undefined` when the number isn't 10 digits
 * or when it fails NANP validity (area code or exchange code starts with
 * 0 or 1). Callers use the undefined return to surface a validation error.
 *
 * If you need full international coverage, international validation, or
 * E.164 output, swap this helper for libphonenumber-js.
 */
export function formatUsPhone(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length !== 10) return undefined
  if (ten[0] === "0" || ten[0] === "1") return undefined
  if (ten[3] === "0" || ten[3] === "1") return undefined
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}
