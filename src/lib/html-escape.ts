/**
 * HTML Escaping Utilities for Email Templates
 *
 * Prevents XSS/HTML injection by escaping special characters in user-provided data
 * before inserting into HTML email templates.
 */

/**
 * Escape HTML special characters to prevent injection.
 * Converts: & < > " ' to their HTML entity equivalents.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return ""
  }

  const str = String(value)

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

/**
 * Escape HTML and convert newlines to <br> for multi-line content.
 */
export function escapeHtmlMultiline(value: string | null | undefined): string {
  return escapeHtml(value).replace(/\n/g, "<br>")
}

/**
 * Escape a URL for use in href attributes.
 * Prevents javascript: and data: URL injection.
 */
export function escapeUrl(url: string | null | undefined): string {
  if (!url) return ""

  const str = String(url).trim()

  // Block potentially dangerous URL schemes
  const lowerUrl = str.toLowerCase()
  if (
    lowerUrl.startsWith("javascript:") ||
    lowerUrl.startsWith("data:") ||
    lowerUrl.startsWith("vbscript:")
  ) {
    return ""
  }

  // Escape HTML entities in the URL
  return escapeHtml(str)
}

/**
 * Helper to safely build an HTML attribute value.
 * Use for dynamic attributes like href, src, etc.
 */
export function attr(value: string | null | undefined): string {
  return escapeHtml(value)
}

/**
 * Shorthand alias for escapeHtml - use in template literals.
 * Example: `<p>Hello ${h(userName)}</p>`
 */
export const h = escapeHtml
