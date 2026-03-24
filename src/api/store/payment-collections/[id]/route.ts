/**
 * Store API route to retrieve payment collection by ID
 * GET /store/payment-collections/:id
 *
 * No ownership scope — collection IDs are random UUIDs and not guessable.
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: [paymentCollection] } = await query.graph({
      entity: "payment_collection",
      fields: [
        "id",
        "amount",
        "currency_code",
        "status",
        "payment_sessions.*",
        "order.id",
        "order.display_id",
      ],
      filters: { id },
    })

    if (!paymentCollection) {
      return res.status(404).json({
        message: "Payment collection not found",
      })
    }

    return res.json({
      payment_collection: paymentCollection,
    })
  } catch (error) {
    return res.status(500).json({
      message: (error as Error).message,
    })
  }
}
