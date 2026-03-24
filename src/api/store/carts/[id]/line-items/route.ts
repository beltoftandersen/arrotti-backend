/**
 * Override: POST /store/carts/:id/line-items
 *
 * Uses the lightweight add-to-cart workflow with conditional refresh:
 * - Fast path: cart has no shipping methods, promotions, or address → skip refresh
 * - Full path: cart already in checkout flow → run full refresh for correctness
 *
 * The core middleware (body validation, query config) still applies.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
  MedusaError,
} from "@medusajs/framework/utils"
import { lightweightAddToCartWorkflow } from "../../../../../workflows/lightweight-add-to-cart"

async function refetchCart(id: string, scope: any, fields: string[]) {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id } },
    fields,
  })
  const [cart] = await remoteQuery(queryObject)
  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart with id '${id}' not found`
    )
  }
  return cart
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await lightweightAddToCartWorkflow(req.scope).run({
    input: {
      cart_id: req.params.id,
      items: [(req as any).validatedBody],
      additional_data: (req as any).validatedBody.additional_data,
    },
  })

  const cart = await refetchCart(
    req.params.id,
    req.scope,
    (req as any).queryConfig.fields
  )
  res.status(200).json({ cart })
}
