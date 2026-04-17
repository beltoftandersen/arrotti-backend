// my-medusa-store/src/api/store/customers/me/payment-methods/[pm_id]/route.ts
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Stripe from "stripe"

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

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  const { pm_id } = req.params
  // Format check only — real authorization is the pm.customer comparison below.
  if (!pm_id || !pm_id.startsWith("pm_")) {
    return res.status(400).json({ message: "Invalid payment method id" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const accountHolder = await getStripeAccountHolder(customerId, query)
  const stripeCustomerId = accountHolder?.external_id
  if (!stripeCustomerId) {
    return res.status(404).json({ message: "No saved payment methods" })
  }

  const stripeKey = process.env.STRIPE_API_KEY
  if (!stripeKey) {
    return res.status(500).json({ message: "Stripe not configured" })
  }
  const stripe = new Stripe(stripeKey)

  try {
    const pm = await stripe.paymentMethods.retrieve(pm_id)
    if (pm.customer !== stripeCustomerId) {
      return res.status(403).json({ message: "Not your payment method" })
    }
    await stripe.paymentMethods.detach(pm_id)
    return res.json({ deleted: true, id: pm_id })
  } catch (err) {
    const e = err as Stripe.errors.StripeError
    if (e?.code === "resource_missing") {
      return res.status(404).json({ message: "Payment method not found" })
    }
    req.scope.resolve("logger").error(
      `[payment-methods] detach failed: ${e?.message ?? String(err)}`
    )
    return res.status(500).json({ message: "Failed to detach card" })
  }
}
