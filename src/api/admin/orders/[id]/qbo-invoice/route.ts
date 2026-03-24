/**
 * Admin API route to manually create QBO invoice for an order
 * POST /admin/orders/:id/qbo-invoice - Create invoice
 * GET /admin/orders/:id/qbo-invoice - Check if invoice exists (and save to order metadata)
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createQboInvoiceForOrder } from "../../../../../lib/qbo-invoice-creator"
import { QboClient } from "../../../../../lib/qbo-client"
import { findInvoiceByOrderNumber } from "../../../../../lib/qbo-invoice"
import { QBO_CONNECTION_MODULE } from "../../../../../modules/qbo-connection"
import QboConnectionService from "../../../../../modules/qbo-connection/service"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type InvoiceMetadata = {
  connected: boolean
  exists: boolean
  invoice_id?: string
  invoice_number?: string
  total?: number
  balance?: number
  is_paid?: boolean
  last_checked: string
}

async function saveInvoiceToOrderMetadata(
  orderId: string,
  invoiceData: InvoiceMetadata,
  scope: any
) {
  try {
    const orderService = scope.resolve(Modules.ORDER)
    const query = scope.resolve(ContainerRegistrationKeys.QUERY)

    // Get current order metadata
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })

    if (order) {
      const currentMetadata = (order.metadata || {}) as Record<string, any>
      await orderService.updateOrders([{
        id: orderId,
        metadata: {
          ...currentMetadata,
          qbo_invoice: invoiceData,
        },
      }])
    }
  } catch (error) {
    console.error("[QBO] Failed to save invoice metadata:", error)
    // Don't throw - this is a nice-to-have feature
  }
}

/**
 * GET /admin/orders/:id/qbo-invoice
 * Check if invoice exists for this order
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  try {
    const qboConnectionService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    // Check if QBO is connected
    const isConnected = await qboConnectionService.isConnected()
    if (!isConnected) {
      const result = {
        connected: false,
        exists: false,
        message: "QuickBooks is not connected",
        last_checked: new Date().toISOString(),
      }
      await saveInvoiceToOrderMetadata(orderId, result, req.scope)
      return res.json(result)
    }

    // Get order to find display_id
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "display_id"],
      filters: { id: orderId },
    })

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    const orderNumber = order.display_id?.toString() || order.id

    // Check if invoice exists
    const client = new QboClient(qboConnectionService)
    const existingInvoice = await findInvoiceByOrderNumber(client, orderNumber)

    const lastChecked = new Date().toISOString()

    if (existingInvoice) {
      const balance = existingInvoice.Balance ?? 0
      const result: InvoiceMetadata = {
        connected: true,
        exists: true,
        invoice_id: existingInvoice.Id,
        invoice_number: existingInvoice.DocNumber,
        total: existingInvoice.TotalAmt,
        balance: balance,
        is_paid: balance <= 0,
        last_checked: lastChecked,
      }
      await saveInvoiceToOrderMetadata(orderId, result, req.scope)
      return res.json(result)
    }

    const result: InvoiceMetadata = {
      connected: true,
      exists: false,
      last_checked: lastChecked,
    }
    await saveInvoiceToOrderMetadata(orderId, result, req.scope)
    return res.json(result)
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * POST /admin/orders/:id/qbo-invoice
 * Create invoice for this order
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  try {
    const result = await createQboInvoiceForOrder(orderId, req.scope)

    if (result.success) {
      // Save invoice info to order metadata
      // New invoices have balance = total (unpaid)
      const invoiceData: InvoiceMetadata = {
        connected: true,
        exists: true,
        invoice_id: result.invoiceId,
        invoice_number: result.invoiceNumber,
        total: result.total,
        balance: result.total,
        is_paid: false,
        last_checked: new Date().toISOString(),
      }
      await saveInvoiceToOrderMetadata(orderId, invoiceData, req.scope)

      return res.json({
        success: true,
        invoice_id: result.invoiceId,
        invoice_number: result.invoiceNumber,
        total: result.total,
        balance: result.total,
        is_paid: false,
        message: result.message,
        already_exists: result.alreadyExists || false,
      })
    } else {
      return res.status(400).json({
        success: false,
        message: result.message,
      })
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: (error as Error).message,
    })
  }
}
