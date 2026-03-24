/**
 * QuickBooks Online OAuth 2.0 helpers
 */

import crypto from "crypto"

const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2"
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"

// Sandbox vs Production base URLs
const QBO_API_BASE = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
}

export function getQboConfig() {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  const redirectUri = process.env.QBO_REDIRECT_URI
  const environment = (process.env.QBO_ENVIRONMENT || "sandbox") as "sandbox" | "production"

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing QBO_CLIENT_ID, QBO_CLIENT_SECRET, or QBO_REDIRECT_URI environment variables")
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    environment,
    apiBase: QBO_API_BASE[environment],
  }
}

/**
 * Generate the authorization URL to redirect user to Intuit login
 */
export function getAuthorizationUrl(state: string): string {
  const config = getQboConfig()

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state,
  })

  return `${QBO_AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number // seconds
  x_refresh_token_expires_in: number // seconds
}> {
  const config = getQboConfig()

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange code for tokens: ${error}`)
  }

  return response.json()
}

/**
 * Refresh the access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}> {
  const config = getQboConfig()

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")

  const response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to refresh token: ${error}`)
  }

  return response.json()
}

/**
 * Revoke tokens (for disconnect)
 */
export async function revokeToken(token: string): Promise<void> {
  const config = getQboConfig()

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")

  await fetch(QBO_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      token,
    }),
  })
  // Ignore response - revoke may fail if token already expired
}

/**
 * Get company info from QBO API to verify connection
 */
export async function getCompanyInfo(
  accessToken: string,
  realmId: string
): Promise<{ companyName: string }> {
  const config = getQboConfig()

  const response = await fetch(
    `${config.apiBase}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get company info: ${error}`)
  }

  const data = await response.json()
  return {
    companyName: data.CompanyInfo?.CompanyName || "Unknown Company",
  }
}

/**
 * Calculate token expiration dates
 */
export function calculateExpirationDates(expiresIn: number, refreshExpiresIn: number): {
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
} {
  const now = Date.now()
  return {
    accessTokenExpiresAt: new Date(now + expiresIn * 1000),
    refreshTokenExpiresAt: new Date(now + refreshExpiresIn * 1000),
  }
}

/**
 * OAuth State CSRF Protection
 *
 * Uses HMAC-SHA256 to sign the state value, preventing forgery.
 * Format: {nonce}.{timestamp}.{signature}
 */

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function getOAuthSecret(): string {
  const secret = process.env.COOKIE_SECRET || process.env.JWT_SECRET
  if (!secret) {
    throw new Error("Missing COOKIE_SECRET or JWT_SECRET for OAuth state signing")
  }
  return secret
}

/**
 * Generate a signed OAuth state value
 * Returns a string in format: {nonce}.{timestamp}.{signature}
 */
export function generateSignedOAuthState(): string {
  const nonce = crypto.randomBytes(16).toString("hex")
  const timestamp = Date.now().toString()
  const payload = `${nonce}.${timestamp}`

  const signature = crypto
    .createHmac("sha256", getOAuthSecret())
    .update(payload)
    .digest("hex")

  return `${payload}.${signature}`
}

/**
 * Verify a signed OAuth state value
 * Returns true if valid and not expired, false otherwise
 */
export function verifySignedOAuthState(state: string): boolean {
  if (!state || typeof state !== "string") {
    return false
  }

  const parts = state.split(".")
  if (parts.length !== 3) {
    return false
  }

  const [nonce, timestamp, signature] = parts

  // Verify timestamp is not expired
  const stateTime = parseInt(timestamp, 10)
  if (isNaN(stateTime) || Date.now() - stateTime > OAUTH_STATE_TTL_MS) {
    console.warn("[QBO OAuth] State expired or invalid timestamp")
    return false
  }

  // Verify signature
  const payload = `${nonce}.${timestamp}`
  const expectedSignature = crypto
    .createHmac("sha256", getOAuthSecret())
    .update(payload)
    .digest("hex")

  // Use timing-safe comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false
  }

  const signatureValid = crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex")
  )

  if (!signatureValid) {
    console.warn("[QBO OAuth] Invalid state signature")
  }

  return signatureValid
}
