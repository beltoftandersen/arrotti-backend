// my-medusa-store/src/api/store/customers/me/payment-methods/route.ts
import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

async function getStripeAccountHolder(
  customerId: string,
  query: any
) {
  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "account_holders.*"],
    filters: {
      id: customerId,
    },
  })

  return (
    customers?.[0]?.account_holders?.find(
      (accountHolder: any) =>
        accountHolder &&
        accountHolder.provider_id === STRIPE_PROVIDER_ID &&
        !accountHolder.deleted_at
    ) ?? null
  )
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const paymentModule = req.scope.resolve(Modules.PAYMENT)
  const accountHolder = await getStripeAccountHolder(customerId, query)

  if (!accountHolder) {
    return res.json({ payment_methods: [] })
  }

  try {
    const paymentMethods = await paymentModule.listPaymentMethods({
      provider_id: STRIPE_PROVIDER_ID,
      context: { account_holder: accountHolder },
    } as any)

    const normalized = (paymentMethods ?? []).map((pm: any) => ({
      id: pm.id,
      brand: pm.data?.card?.brand ?? null,
      last4: pm.data?.card?.last4 ?? null,
      exp_month: pm.data?.card?.exp_month ?? null,
      exp_year: pm.data?.card?.exp_year ?? null,
    }))

    return res.json({ payment_methods: normalized })
  } catch (err) {
    req.scope.resolve("logger").error(
      `[payment-methods] listPaymentMethods failed: ${(err as Error).message}`
    )
    return res.status(500).json({ message: "Failed to load saved cards" })
  }
}
