import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { respondToQuoteWorkflow } from "../../../../../workflows/respond-to-quote"

/**
 * POST /store/quotes/:id/reject
 *
 * Reject a quoted price
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "Authentication required" })
    return
  }

  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify quote exists and belongs to customer
  const { data: quotes } = await query.graph({
    entity: "quote",
    fields: ["id", "customer_id", "status"],
    filters: { id },
  })

  if (!quotes?.length || quotes[0].customer_id !== customerId) {
    res.status(404).json({ message: "Quote not found" })
    return
  }

  if (quotes[0].status !== "quoted") {
    res.status(400).json({
      message: `Cannot reject a quote with status "${quotes[0].status}". Only "quoted" quotes can be rejected.`,
    })
    return
  }

  const { result } = await respondToQuoteWorkflow(req.scope).run({
    input: { id, action: "reject" },
  })

  res.json({ quote: result.quote })
}
