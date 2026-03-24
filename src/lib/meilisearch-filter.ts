/**
 * Meilisearch Filter Security Utilities
 *
 * Provides functions to safely build Meilisearch filter expressions
 * from user-provided input, preventing filter injection attacks.
 */

/**
 * Escape special characters in Meilisearch filter values to prevent injection.
 * Meilisearch filter syntax uses double quotes for string values.
 * Characters that need escaping: " (double quote) and \ (backslash)
 */
export function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/"/g, '\\"')   // Escape double quotes
}

/**
 * Validate that a value looks like a valid Medusa ID.
 * IDs typically follow patterns like: prod_xxx, cat_xxx, pcol_xxx, brand_xxx, etc.
 * Also allows UUIDs and simple alphanumeric strings.
 * Returns the value if valid, null if suspicious.
 */
export function validateId(value: string): string | null {
  // Allow: alphanumeric, underscores, hyphens (covers Medusa IDs and UUIDs)
  // Max length 100 to prevent abuse
  if (/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    return value
  }
  return null
}

/**
 * Build a safe Meilisearch filter expression for string equality.
 * Escapes the value to prevent filter injection.
 */
export function safeFilterEq(field: string, value: string): string {
  return `${field} = "${escapeFilterValue(value)}"`
}

/**
 * Build a safe OR filter for multiple values on the same field.
 * Validates IDs and escapes values.
 */
export function safeFilterOr(
  field: string,
  values: string[],
  options: { validateIds?: boolean } = {}
): string | null {
  const { validateIds = true } = options

  let safeValues = values
  if (validateIds) {
    safeValues = values
      .map(validateId)
      .filter((v): v is string => v !== null)
  }

  if (safeValues.length === 0) {
    return null
  }

  const filter = safeValues
    .map((value) => safeFilterEq(field, value))
    .join(" OR ")

  return safeValues.length > 1 ? `(${filter})` : filter
}
