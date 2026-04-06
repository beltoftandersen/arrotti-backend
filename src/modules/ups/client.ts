// src/modules/ups/client.ts

import { MedusaError } from "@medusajs/framework/utils"
import {
  UpsOptions,
  OAuthTokenResponse,
  RateRequest,
  RateResponseBody,
  ShipmentRequest,
  ShipmentResponseBody,
  VoidResponseBody,
} from "./types"

const DEFAULT_BASE_URL = "https://onlinetools.ups.com"
const REQUEST_TIMEOUT_MS = 30_000
// Refresh 5 minutes before expiry to avoid edge-case failures
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export class UpsClient {
  protected options: UpsOptions
  protected baseUrl: string
  private accessToken: string | null = null
  private tokenExpiresAt: number = 0

  constructor(options: UpsOptions) {
    this.options = options
    this.baseUrl = options.base_url || DEFAULT_BASE_URL
  }

  /**
   * Get a valid OAuth access token, refreshing if needed.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken
    }

    // Retry once on failure before throwing
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const credentials = Buffer.from(
        `${this.options.client_id}:${this.options.client_secret}`
      ).toString("base64")

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      let resp: Response
      try {
        resp = await fetch(`${this.baseUrl}/security/v1/oauth/token`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        })
      } catch (error: any) {
        clearTimeout(timeout)
        if (error.name === "AbortError") {
          lastError = new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            "UPS OAuth token request timed out"
          )
          continue
        }
        lastError = error
        continue
      } finally {
        clearTimeout(timeout)
      }

      if (!resp.ok) {
        let detail = `${resp.status} ${resp.statusText}`
        try {
          const body = await resp.json()
          if (body?.response?.errors?.length) {
            detail = body.response.errors
              .map((e: any) => e.message)
              .join(", ")
          }
        } catch {}
        lastError = new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `UPS OAuth error: ${detail}`
        )
        continue
      }

      const data: OAuthTokenResponse = await resp.json()
      this.accessToken = data.access_token
      const expiresInMs = parseInt(data.expires_in, 10) * 1000
      this.tokenExpiresAt = Date.now() + expiresInMs - TOKEN_REFRESH_BUFFER_MS

      return this.accessToken
    }

    throw lastError!
  }

  /**
   * Send an authenticated request to the UPS REST API.
   */
  private async sendRequest(
    url: string,
    init?: RequestInit
  ): Promise<any> {
    const token = await this.getAccessToken()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let resp: Response
    try {
      resp = await fetch(`${this.baseUrl}${url}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          transId: `medusa-${Date.now()}`,
          transactionSrc: "medusa",
        },
      })
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `UPS request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (!resp.ok) {
      let errorDetail = `${resp.status} ${resp.statusText}`
      try {
        const body = await resp.json()
        if (body?.response?.errors?.length) {
          errorDetail = body.response.errors
            .map((e: any) => `${e.code}: ${e.message}`)
            .join(", ")
        }
      } catch {}
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `UPS API error (${resp.status}): ${errorDetail}`
      )
    }

    return resp.json()
  }

  /**
   * Get shipping rates for a shipment.
   * UPS Rating API v2403
   */
  async getRates(data: RateRequest): Promise<RateResponseBody> {
    return this.sendRequest(
      "/api/rating/v2403/Rate",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    )
  }

  /**
   * Create a shipment and purchase a label.
   * UPS Shipping API v2409
   */
  async createShipment(
    data: ShipmentRequest
  ): Promise<ShipmentResponseBody> {
    return this.sendRequest(
      "/api/shipments/v2409/ship",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    )
  }

  /**
   * Void a shipment by tracking number.
   * UPS Shipping API v2409
   */
  async voidShipment(trackingNumber: string): Promise<VoidResponseBody> {
    return this.sendRequest(
      `/api/shipments/v2409/void/cancel/${trackingNumber}`,
      { method: "DELETE" }
    )
  }
}
