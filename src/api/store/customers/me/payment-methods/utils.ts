import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

export async function getStripeAccountHolder(
  req: AuthenticatedMedusaRequest
) {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    return null
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: customers } = await query.graph({
    entity: "customer",
    fields: [
      "id",
      "account_holders.id",
      "account_holders.provider_id",
      "account_holders.external_id",
      "account_holders.data",
      "account_holders.deleted_at",
    ],
    filters: {
      id: customerId,
    },
  })

  return (
    customers?.[0]?.account_holders?.find(
      (accountHolder: any) =>
        accountHolder &&
        accountHolder.provider_id === STRIPE_PROVIDER_ID &&
        !accountHolder.deleted_at &&
        typeof accountHolder.external_id === "string" &&
        accountHolder.external_id.length > 0
    ) ?? null
  )
}
