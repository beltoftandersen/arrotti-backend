/**
 * QuickBooks Online API Client
 * Handles authenticated requests with automatic token refresh
 */

import { getQboConfig, refreshAccessToken, calculateExpirationDates } from "./qbo-oauth"
import { fetchWithRetry } from "./qbo-retry"

type QboConnectionRecord = {
  id: string
  realm_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: Date
  refresh_token_expires_at: Date
}

type QboConnectionService = {
  getConnection(): Promise<QboConnectionRecord | null>
  updateTokens(
    accessToken: string,
    refreshToken: string,
    accessTokenExpiresAt: Date,
    refreshTokenExpiresAt: Date
  ): Promise<void>
}

export class QboClient {
  private connectionService: QboConnectionService
  private config: ReturnType<typeof getQboConfig>

  constructor(connectionService: QboConnectionService) {
    this.connectionService = connectionService
    this.config = getQboConfig()
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidToken(): Promise<{ accessToken: string; realmId: string }> {
    const connection = await this.connectionService.getConnection()
    if (!connection) {
      throw new Error("No QuickBooks connection found")
    }

    const now = new Date()

    // Check if refresh token is expired
    if (new Date(connection.refresh_token_expires_at) <= now) {
      throw new Error("QuickBooks connection expired. Please reconnect.")
    }

    // Check if access token needs refresh (5 min buffer)
    const bufferMs = 5 * 60 * 1000
    if (new Date(connection.access_token_expires_at).getTime() - bufferMs < now.getTime()) {
      // Refresh the token
      console.log("[QBO] Access token expired, refreshing...")
      const tokens = await refreshAccessToken(connection.refresh_token)
      const { accessTokenExpiresAt, refreshTokenExpiresAt } = calculateExpirationDates(
        tokens.expires_in,
        tokens.x_refresh_token_expires_in
      )

      await this.connectionService.updateTokens(
        tokens.access_token,
        tokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt
      )

      return {
        accessToken: tokens.access_token,
        realmId: connection.realm_id,
      }
    }

    return {
      accessToken: connection.access_token,
      realmId: connection.realm_id,
    }
  }

  /**
   * Force a token refresh regardless of current expiration (used by retry
   * wrapper when a request unexpectedly hits 401).
   */
  private async forceRefresh(): Promise<void> {
    const connection = await this.connectionService.getConnection()
    if (!connection) throw new Error("No QuickBooks connection found")
    if (new Date(connection.refresh_token_expires_at) <= new Date()) {
      throw new Error("QuickBooks connection expired. Please reconnect.")
    }
    console.log("[QBO] 401 received, forcing token refresh")
    const tokens = await refreshAccessToken(connection.refresh_token)
    const { accessTokenExpiresAt, refreshTokenExpiresAt } = calculateExpirationDates(
      tokens.expires_in,
      tokens.x_refresh_token_expires_in
    )
    await this.connectionService.updateTokens(
      tokens.access_token,
      tokens.refresh_token,
      accessTokenExpiresAt,
      refreshTokenExpiresAt
    )
  }

  /**
   * Make an authenticated GET request to QBO API
   */
  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const response = await fetchWithRetry(
      { label: `GET ${endpoint}`, detail: params ? JSON.stringify(params) : undefined },
      async () => {
        const { accessToken, realmId } = await this.getValidToken()
        let url = `${this.config.apiBase}/v3/company/${realmId}/${endpoint}`
        if (params) {
          url += `?${new URLSearchParams(params).toString()}`
        }
        return fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        })
      },
      () => this.forceRefresh()
    )
    return response.json()
  }

  /**
   * Make an authenticated POST request to QBO API
   */
  async post<T>(endpoint: string, data: unknown): Promise<T> {
    const response = await fetchWithRetry(
      { label: `POST ${endpoint}` },
      async () => {
        const { accessToken, realmId } = await this.getValidToken()
        const url = `${this.config.apiBase}/v3/company/${realmId}/${endpoint}`
        return fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(data),
        })
      },
      () => this.forceRefresh()
    )
    return response.json()
  }

  /**
   * Query QBO entities using SQL-like syntax
   */
  async query<T>(query: string): Promise<T> {
    const response = await fetchWithRetry(
      { label: "QBO query", detail: query.slice(0, 200) },
      async () => {
        const { accessToken, realmId } = await this.getValidToken()
        const url = `${this.config.apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`
        return fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        })
      },
      () => this.forceRefresh()
    )
    return response.json()
  }

  /**
   * Get the realm ID (company ID)
   */
  async getRealmId(): Promise<string> {
    const { realmId } = await this.getValidToken()
    return realmId
  }
}
