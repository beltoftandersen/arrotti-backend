/**
 * Admin API route to get/set QBO settings
 * GET /admin/qbo/settings - Get current settings
 * PUT /admin/qbo/settings - Update settings
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QBO_CONNECTION_MODULE } from "../../../../modules/qbo-connection"
import QboConnectionService from "../../../../modules/qbo-connection/service"

/**
 * GET /admin/qbo/settings
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const qboConnectionService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    const isConnected = await qboConnectionService.isConnected()
    const autoInvoiceEnabled = await qboConnectionService.isAutoInvoiceEnabled()
    const connection = await qboConnectionService.getConnection()

    return res.json({
      connected: isConnected,
      company_name: (connection as any)?.company_name || null,
      auto_invoice_enabled: autoInvoiceEnabled,
    })
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * PUT /admin/qbo/settings
 * Body: { auto_invoice_enabled: boolean }
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { auto_invoice_enabled } = req.body as { auto_invoice_enabled?: boolean }

  if (auto_invoice_enabled === undefined) {
    return res.status(400).json({ message: "auto_invoice_enabled is required" })
  }

  try {
    const qboConnectionService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    await qboConnectionService.setAutoInvoiceEnabled(auto_invoice_enabled)

    return res.json({
      auto_invoice_enabled,
      message: auto_invoice_enabled
        ? "Auto invoice enabled - invoices will be created when orders are placed"
        : "Auto invoice disabled - use manual invoice creation from order details",
    })
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}
