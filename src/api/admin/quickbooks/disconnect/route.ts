import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QBO_CONNECTION_MODULE } from "../../../../modules/qbo-connection"
import QboConnectionService from "../../../../modules/qbo-connection/service"
import { revokeToken } from "../../../../lib/qbo-oauth"

/**
 * POST /admin/quickbooks/disconnect
 * Disconnects from QuickBooks (revokes tokens and removes connection)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const qboService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    const connection = await qboService.getConnection()

    if (!connection) {
      return res.json({
        success: true,
        message: "No connection to disconnect",
      })
    }

    // Try to revoke the token (best effort)
    try {
      await revokeToken(connection.refresh_token)
    } catch (e) {
      console.warn("[QBO] Could not revoke token:", (e as Error).message)
      // Continue with disconnect anyway
    }

    // Remove connection from database
    await qboService.disconnect()

    console.log(`[QBO] Disconnected from "${connection.company_name}"`)

    res.json({
      success: true,
      message: `Disconnected from ${connection.company_name}`,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    })
  }
}
