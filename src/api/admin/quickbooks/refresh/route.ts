import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QBO_CONNECTION_MODULE } from "../../../../modules/qbo-connection"
import QboConnectionService from "../../../../modules/qbo-connection/service"
import { refreshAccessToken, calculateExpirationDates } from "../../../../lib/qbo-oauth"

/**
 * POST /admin/quickbooks/refresh
 * Manually refresh the access token
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const qboService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    const connection = await qboService.getConnection()

    if (!connection) {
      return res.status(400).json({
        success: false,
        error: "No QuickBooks connection found",
      })
    }

    // Check if refresh token is still valid
    if (new Date(connection.refresh_token_expires_at) <= new Date()) {
      return res.status(400).json({
        success: false,
        error: "Refresh token expired. Please reconnect to QuickBooks.",
      })
    }

    // Refresh the tokens
    const tokens = await refreshAccessToken(connection.refresh_token)

    const { accessTokenExpiresAt, refreshTokenExpiresAt } = calculateExpirationDates(
      tokens.expires_in,
      tokens.x_refresh_token_expires_in
    )

    // Update tokens in database
    await qboService.updateTokens(
      tokens.access_token,
      tokens.refresh_token,
      accessTokenExpiresAt,
      refreshTokenExpiresAt
    )

    console.log(`[QBO] Tokens refreshed for "${connection.company_name}"`)

    res.json({
      success: true,
      message: "Tokens refreshed successfully",
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
    })
  } catch (error) {
    console.error("[QBO] Refresh error:", error)
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
}
