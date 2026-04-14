/**
 * Retry wrapper for QBO API and OAuth requests.
 *
 * Policy:
 *   - Up to MAX_RETRIES retries (so MAX_RETRIES + 1 total attempts)
 *   - RETRY_DELAY_MS between attempts (no exponential backoff — Intuit
 *     documents short transient failures, 30s linear is plenty)
 *   - Retriable: HTTP 429, 5xx, and network-level errors (fetch throws)
 *   - Non-retriable: HTTP 4xx (except 429) — 401 is handled separately
 *     by the caller with a force-refresh + single retry.
 *   - On exhaustion, sends an alert email via qbo-alert.ts and rethrows.
 */

import { sendQboAlert } from "./qbo-alert"

export const MAX_RETRIES = 3
export const RETRY_DELAY_MS = 30_000

export class QboHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string
  ) {
    super(`QBO ${endpoint} returned ${status}: ${body.slice(0, 500)}`)
    this.name = "QboHttpError"
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

export interface RetryContext {
  /** Short label for logs and alert subject (e.g. "POST invoice", "refreshToken"). */
  label: string
  /** Extra detail included in the alert email body. */
  detail?: string
}

/**
 * Run a fetch operation with retry. The operation must do the fetch and return
 * the Response (or throw for network errors). This wrapper decides whether
 * to retry based on status + thrown errors.
 *
 * If `onAuthFailure` is supplied and the response is 401, it's called once
 * to force a token refresh; the operation is then retried immediately (not
 * counted against MAX_RETRIES).
 */
export async function fetchWithRetry(
  ctx: RetryContext,
  operation: () => Promise<Response>,
  onAuthFailure?: () => Promise<void>
): Promise<Response> {
  let lastError: Error | null = null
  let authRetried = false

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await operation()

      if (res.ok) return res

      // 401: one free retry after token refresh
      if (res.status === 401 && onAuthFailure && !authRetried) {
        authRetried = true
        console.warn(`[QBO] ${ctx.label} got 401, forcing token refresh and retrying once`)
        await onAuthFailure()
        continue // do not consume a retry slot
      }

      const body = await res.text()
      const err = new QboHttpError(res.status, body, ctx.label)

      if (!isRetriableStatus(res.status)) {
        // Non-retriable (4xx other than 429) — fail fast, no alert
        throw err
      }

      lastError = err
      console.warn(
        `[QBO] ${ctx.label} attempt ${attempt + 1}/${MAX_RETRIES + 1} ` +
          `failed with ${res.status}; ${attempt < MAX_RETRIES ? `retrying in ${RETRY_DELAY_MS / 1000}s` : "exhausted"}`
      )
    } catch (e: any) {
      if (e instanceof QboHttpError && !isRetriableStatus(e.status)) {
        throw e
      }
      lastError = e instanceof Error ? e : new Error(String(e))
      console.warn(
        `[QBO] ${ctx.label} attempt ${attempt + 1}/${MAX_RETRIES + 1} ` +
          `threw: ${lastError.message}; ${attempt < MAX_RETRIES ? `retrying in ${RETRY_DELAY_MS / 1000}s` : "exhausted"}`
      )
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS)
    }
  }

  // All retries exhausted — alert and rethrow
  const alertBody = [
    `QuickBooks ${ctx.label} failed after ${MAX_RETRIES + 1} attempts.`,
    ctx.detail ? `\nDetail: ${ctx.detail}` : "",
    lastError ? `\nLast error: ${lastError.message}` : "",
    "",
    "Check backend logs and QBO connection health in the admin panel.",
  ].join("\n")

  await sendQboAlert(`${ctx.label} failed after ${MAX_RETRIES + 1} attempts`, alertBody)

  throw lastError ?? new Error(`QBO ${ctx.label} failed after retries`)
}
