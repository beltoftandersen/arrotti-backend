/**
 * Convert BigNumber or number to a numeric value.
 * Medusa V2 returns BigNumber objects for money fields.
 */
export function toNumber(value: any): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

/**
 * Format a numeric amount as a currency string (e.g., "$12.50").
 */
export function formatPrice(amount: any, currencyCode: string): string {
  const numericAmount = toNumber(amount)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode?.toUpperCase() || "USD",
  }).format(numericAmount)
}
