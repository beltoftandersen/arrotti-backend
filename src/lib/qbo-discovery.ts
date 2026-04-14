/**
 * OAuth 2.0 / OpenID Connect Discovery document loader.
 *
 * Intuit publishes a Discovery document per environment with the current
 * endpoint URLs (authorization, token, userinfo, revocation, jwks_uri).
 * Using the Discovery document means our app picks up any endpoint
 * changes automatically instead of hardcoding URLs.
 *
 * Docs: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-openid-discovery-doc
 */

const DISCOVERY_URLS = {
  sandbox: "https://developer.intuit.com/.well-known/openid_sandbox_configuration",
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface QboDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  revocation_endpoint: string
  jwks_uri: string
  response_types_supported: string[]
  subject_types_supported: string[]
  id_token_signing_alg_values_supported: string[]
  scopes_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  claims_supported: string[]
}

type CacheEntry = {
  doc: QboDiscoveryDocument
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

// Hardcoded fallbacks used if Discovery is unreachable — matches documented
// endpoints at the time of writing.
const FALLBACK: Record<"sandbox" | "production", QboDiscoveryDocument> = {
  sandbox: {
    issuer: "https://oauth.platform.intuit.com/op/v1",
    authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
    token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    userinfo_endpoint: "https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo",
    revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    jwks_uri: "https://oauth.platform.intuit.com/op/v1/jwks",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email", "profile", "address", "phone"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: [
      "aud",
      "exp",
      "iat",
      "iss",
      "realmid",
      "sub",
    ],
  },
  production: {
    issuer: "https://oauth.platform.intuit.com/op/v1",
    authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
    token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    userinfo_endpoint: "https://accounts.platform.intuit.com/v1/openid_connect/userinfo",
    revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    jwks_uri: "https://oauth.platform.intuit.com/op/v1/jwks",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email", "profile", "address", "phone"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: [
      "aud",
      "exp",
      "iat",
      "iss",
      "realmid",
      "sub",
    ],
  },
}

export async function getDiscoveryDocument(
  environment: "sandbox" | "production"
): Promise<QboDiscoveryDocument> {
  const cached = cache.get(environment)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.doc
  }

  const url = DISCOVERY_URLS[environment]
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(`Discovery doc fetch returned ${res.status}`)
    }
    const doc = (await res.json()) as QboDiscoveryDocument
    cache.set(environment, { doc, fetchedAt: Date.now() })
    return doc
  } catch (e: any) {
    console.warn(
      `[QBO Discovery] fetch failed for ${environment} (${e?.message || e}); ` +
        `using hardcoded fallback endpoints`
    )
    // Cache the fallback for a shorter time so we try again soon
    const fallback = FALLBACK[environment]
    cache.set(environment, { doc: fallback, fetchedAt: Date.now() - (CACHE_TTL_MS - 60 * 60 * 1000) })
    return fallback
  }
}
