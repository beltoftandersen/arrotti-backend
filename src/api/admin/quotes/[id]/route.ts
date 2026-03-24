import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { QUOTE_MODULE } from "../../../../modules/quote"
import QuoteModuleService from "../../../../modules/quote/service"
import { enrichQuotes } from "../enrich"

/**
 * GET /admin/quotes/:id
 *
 * Get a single quote with full details
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
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

  const [enriched] = await enrichQuotes(req.scope, [quotes[0]])
  res.json({ quote: enriched })
}

/**
 * DELETE /admin/quotes/:id
 *
 * Delete a quote
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const quoteService: QuoteModuleService = req.scope.resolve(QUOTE_MODULE)

  try {
    await quoteService.deleteQuotes(id)
    res.status(200).json({ id, deleted: true })
  } catch (error: any) {
    res.status(404).json({ message: "Quote not found" })
  }
}
