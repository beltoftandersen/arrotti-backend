import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/quotes/:id
 *
 * Get a single quote (must belong to the authenticated customer)
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "Authentication required" })
    return
  }

  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: quotes } = await query.graph({
    entity: "quote",
    fields: [
      "id",
      "product_id",
      "variant_id",
      "customer_id",
      "quantity",
      "notes",
      "status",
      "quoted_price",
      "currency_code",
      "admin_notes",
      "expires_at",
      "accepted_at",
      "ordered_at",
      "order_id",
      "created_at",
      "updated_at",
    ],
    filters: { id },
  })

  if (!quotes?.length) {
    res.status(404).json({ message: "Quote not found" })
    return
  }

  // Ensure the quote belongs to the requesting customer
  if (quotes[0].customer_id !== customerId) {
    res.status(404).json({ message: "Quote not found" })
    return
  }

  res.json({ quote: quotes[0] })
}
