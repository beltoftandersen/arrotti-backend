import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createQuoteWorkflow } from "../../../workflows/create-quote"
import { QUOTE_MODULE } from "../../../modules/quote"
import QuoteModuleService from "../../../modules/quote/service"

type CreateQuoteBody = {
  product_id: string
  variant_id?: string
  quantity?: number
  notes?: string
}

/**
 * POST /store/quotes
 *
 * Create a new quote request (requires authentication)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "Authentication required" })
    return
  }

  const body = req.body as CreateQuoteBody

  if (!body.product_id) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  try {
    const { result } = await createQuoteWorkflow(req.scope).run({
      input: {
        product_id: body.product_id,
        variant_id: body.variant_id,
        customer_id: customerId,
        quantity: body.quantity ?? 1,
        notes: body.notes,
      },
    })

    // Emit event for notification subscriber
    const eventBus = req.scope.resolve(Modules.EVENT_BUS)
    await eventBus.emit({
      name: "quote.created",
      data: { id: result.quote.id },
    })

    res.status(201).json({ quote: result.quote })
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      res.status(404).json({ message: "Product not found" })
      return
    }
    throw error
  }
}

/**
 * GET /store/quotes
 *
 * List the authenticated customer's quotes
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "Authentication required" })
    return
  }

  const limit = parseInt(req.query.limit as string) || 20
  const offset = parseInt(req.query.offset as string) || 0
  const status = req.query.status as string | undefined

  const quoteService: QuoteModuleService = req.scope.resolve(QUOTE_MODULE)

  const filters: Record<string, any> = { customer_id: customerId }
  if (status) {
    filters.status = status
  }

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

  res.json({
    quotes,
    count,
    limit,
    offset,
  })
}
