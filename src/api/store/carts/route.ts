/**
 * Override: POST /store/carts
 *
 * Uses the lightweight workflow for empty carts (no items).
 * Falls back to the full createCartWorkflow when items are passed.
 *
 * The core middleware (body validation, query config, pub key scoping)
 * still applies — this only replaces the route handler.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
  MedusaError,
} from "@medusajs/framework/utils"
import { createCartWorkflow } from "@medusajs/medusa/core-flows"
import { lightweightCreateCartWorkflow } from "../../../workflows/lightweight-create-cart"

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
  const workflowInput = {
    ...(req as any).validatedBody,
    customer_id: (req as any).auth_context?.actor_id,
  }

  const hasItems = workflowInput.items?.length > 0

  let cartId: string

  if (hasItems) {
    // Cart with items — use full workflow for correct pricing/inventory
    const { result } = await createCartWorkflow(req.scope).run({
      input: workflowInput,
    })
    cartId = result.id
  } else {
    // Empty cart — use lightweight workflow (skip tax/promo/payment)
    const { result } = await lightweightCreateCartWorkflow(req.scope).run({
      input: workflowInput,
    })
    cartId = result.id
  }

  const cart = await refetchCart(
    cartId,
    req.scope,
    (req as any).queryConfig.fields
  )
  res.status(200).json({ cart })
}
