import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QBO_CONNECTION_MODULE } from "../../../../modules/qbo-connection"
import QboConnectionService from "../../../../modules/qbo-connection/service"

/**
 * GET /admin/quickbooks/status
 * Returns the current QBO connection status
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const qboService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    const connection = await qboService.getConnection()

    if (!connection) {
      return res.json({
        connected: false,
        message: "Not connected to QuickBooks",
      })
    }

    const now = new Date()
    const accessTokenExpired = new Date(connection.access_token_expires_at) <= now
    const refreshTokenExpired = new Date(connection.refresh_token_expires_at) <= now

    if (refreshTokenExpired) {
      return res.json({
        connected: false,
        expired: true,
        message: "Connection expired. Please reconnect to QuickBooks.",
        company_name: connection.company_name,
        realm_id: connection.realm_id,
      })
    }

    res.json({
      connected: true,
      company_name: connection.company_name,
      realm_id: connection.realm_id,
      connected_at: connection.connected_at,
      last_refreshed_at: connection.last_refreshed_at,
      access_token_expires_at: connection.access_token_expires_at,
      refresh_token_expires_at: connection.refresh_token_expires_at,
      access_token_expired: accessTokenExpired,
      needs_refresh: accessTokenExpired,
    })
  } catch (error) {
    res.status(500).json({
      connected: false,
      error: (error as Error).message,
    })
  }
}
