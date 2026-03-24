import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { sendQuoteWorkflow } from "../../../../../workflows/send-quote"

type SendQuoteBody = {
  quoted_price: number
  currency_code?: string
  expires_at?: string
  admin_notes?: string
}

/**
 * POST /admin/quotes/:id/send
 *
 * Set a quoted price and send it to the customer
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const body = req.body as SendQuoteBody

  if (typeof body.quoted_price !== "number" || body.quoted_price <= 0) {
    res.status(400).json({ message: "quoted_price must be a positive number" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify quote exists and is in "pending" status
  const { data: quotes } = await query.graph({
    entity: "quote",
    fields: ["id", "status"],
    filters: { id },
  })

  if (!quotes?.length) {
    res.status(404).json({ message: "Quote not found" })
    return
  }

  if (quotes[0].status !== "pending") {
    res.status(400).json({
      message: `Cannot send a quote with status "${quotes[0].status}". Only "pending" quotes can be sent.`,
    })
    return
  }

  const { result } = await sendQuoteWorkflow(req.scope).run({
    input: {
      id,
      quoted_price: body.quoted_price,
      currency_code: body.currency_code,
      expires_at: body.expires_at,
      admin_notes: body.admin_notes,
    },
  })

  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  await eventBus.emit({
    name: "quote.sent",
    data: { id },
  })

  res.json({ quote: result.quote })
}
