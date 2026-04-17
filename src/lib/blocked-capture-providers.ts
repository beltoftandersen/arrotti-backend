/**
 * Payment providers whose "Capture Payment" action is blocked in Medusa.
 *
 * Payments collected with these providers are reconciled directly in
 * QuickBooks (Zelle, cash, check). Their Medusa capture is a no-op, so we
 * block the admin action to prevent accidental clicks that would flip the
 * Medusa `captured_at` timestamp out of sync with QuickBooks reality.
 *
 * Shared between the API middleware (hard block) and the admin banner
 * widget (soft warning) so both surfaces use the same truth.
 */

export const BLOCKED_CAPTURE_PROVIDER_PREFIXES = [
  "pp_system_default",
  "pp_cod-zelle",
] as const

export function isBlockedCaptureProvider(
  providerId: string | null | undefined
): boolean {
  if (!providerId) return false
  return BLOCKED_CAPTURE_PROVIDER_PREFIXES.some((prefix) =>
    providerId.startsWith(prefix)
  )
}

export const BLOCKED_CAPTURE_MESSAGE =
  "This payment was collected externally (Zelle / Cash / Check). Reconcile the invoice in QuickBooks — do not capture in Medusa."
