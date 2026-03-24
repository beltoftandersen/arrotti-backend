import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createReviewWorkflow } from "../../../workflows/create-review"

type CreateReviewBody = {
  title?: string
  content: string
  rating: number
  product_id: string
  first_name: string
  last_name: string
}

/**
 * POST /store/reviews
 *
 * Submit a new product review (starts as "pending" status)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as CreateReviewBody

  // Validate required fields
  if (!body.content || !body.product_id || !body.first_name || !body.last_name) {
    res.status(400).json({
      message: "Missing required fields: content, product_id, first_name, last_name",
    })
    return
  }

  // Validate rating
  if (typeof body.rating !== "number" || body.rating < 1 || body.rating > 5) {
    res.status(400).json({
      message: "Rating must be a number between 1 and 5",
    })
    return
  }

  // Get customer_id if authenticated
  const customerId = (req as any).auth_context?.actor_id

  try {
    const { result } = await createReviewWorkflow(req.scope).run({
      input: {
        title: body.title,
        content: body.content,
        rating: body.rating,
        product_id: body.product_id,
        first_name: body.first_name,
        last_name: body.last_name,
        customer_id: customerId,
      },
    })

    res.status(201).json({ review: result.review })
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      res.status(404).json({ message: "Product not found" })
      return
    }
    throw error
  }
}
