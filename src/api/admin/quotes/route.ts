import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { QUOTE_MODULE } from "../../../modules/quote"
import QuoteModuleService from "../../../modules/quote/service"
import { enrichQuotes } from "./enrich"

/**
 * GET /admin/quotes
 *
 * List all quotes with optional filters
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const limit = parseInt(req.query.limit as string) || 20
  const offset = parseInt(req.query.offset as string) || 0
  const status = req.query.status as string | undefined
  const customer_id = req.query.customer_id as string | undefined
  const product_id = req.query.product_id as string | undefined

  const quoteService: QuoteModuleService = req.scope.resolve(QUOTE_MODULE)

  const filters: Record<string, any> = {}
  if (status) filters.status = status
  if (customer_id) filters.customer_id = customer_id
  if (product_id) filters.product_id = product_id

  const [quotes, count] = await quoteService.listAndCountQuotes(
    filters,
    {
      select: [
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
      skip: offset,
      take: limit,
      order: { created_at: "DESC" },
    }
  )

  const enrichedQuotes = await enrichQuotes(req.scope, quotes as any[])

  res.json({
    quotes: enrichedQuotes,
    count,
    limit,
    offset,
  })
}
