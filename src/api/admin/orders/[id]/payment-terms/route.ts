/**
 * Admin API route to manage payment terms for an order
 * PUT /admin/orders/:id/payment-terms - Set payment terms
 * GET /admin/orders/:id/payment-terms - Get payment terms
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * GET /admin/orders/:id/payment-terms
 * Get payment terms for this order
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    const paymentTermsDays = (order.metadata as any)?.payment_terms_days ?? null

    return res.json({
      order_id: orderId,
      payment_terms_days: paymentTermsDays,
    })
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * PUT /admin/orders/:id/payment-terms
 * Set payment terms for this order
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id
  const { payment_terms_days } = req.body as { payment_terms_days: number | null }

  try {
    const orderService = req.scope.resolve(Modules.ORDER)
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Get current order metadata
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    const currentMetadata = (order.metadata || {}) as Record<string, any>

    // Update metadata with payment terms
    let newMetadata: Record<string, any>
    if (payment_terms_days === null) {
      // Remove payment_terms_days from metadata
      const { payment_terms_days: _, ...rest } = currentMetadata
      newMetadata = rest
    } else {
      newMetadata = {
        ...currentMetadata,
        payment_terms_days,
      }
    }

    await orderService.updateOrders([{
      id: orderId,
      metadata: newMetadata,
    }])

    return res.json({
      success: true,
      order_id: orderId,
      payment_terms_days,
    })
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}
