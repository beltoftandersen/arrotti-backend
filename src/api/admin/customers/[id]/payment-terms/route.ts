/**
 * Admin API route to get/set customer payment terms
 * GET /admin/customers/:id/payment-terms - Get payment terms
 * PUT /admin/customers/:id/payment-terms - Set payment terms
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

// Valid payment term options (in days)
const VALID_PAYMENT_TERMS = [0, 15, 30, 45, 60, 90]

/**
 * GET /admin/customers/:id/payment-terms
 * Returns the customer's current payment terms
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: ["id", "metadata"],
      filters: { id },
    })

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" })
    }

    const paymentTermsDays = customer.metadata?.payment_terms_days ?? null

    return res.json({
      customer_id: id,
      payment_terms_days: paymentTermsDays,
      available_options: VALID_PAYMENT_TERMS.map(days => ({
        value: days,
        label: days === 0 ? "Due on receipt" : `Net ${days}`,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * PUT /admin/customers/:id/payment-terms
 * Sets the customer's payment terms
 * Body: { payment_terms_days: number | null }
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const { payment_terms_days } = req.body as { payment_terms_days: number | null }

  // Validate payment terms
  if (payment_terms_days !== null && !VALID_PAYMENT_TERMS.includes(payment_terms_days)) {
    return res.status(400).json({
      message: `Invalid payment terms. Must be one of: ${VALID_PAYMENT_TERMS.join(", ")}`,
    })
  }

  try {
    const customerService = req.scope.resolve(Modules.CUSTOMER)

    // Get current customer metadata
    const [customer] = await customerService.listCustomers({ id })

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" })
    }

    // Update metadata with payment terms
    const currentMetadata = (customer.metadata as Record<string, unknown>) || {}
    const updatedMetadata: Record<string, unknown> = {
      ...currentMetadata,
    }

    // Set or remove payment terms
    if (payment_terms_days === null) {
      delete updatedMetadata.payment_terms_days
    } else {
      updatedMetadata.payment_terms_days = payment_terms_days
    }

    await customerService.updateCustomers(id, {
      metadata: updatedMetadata,
    })

    return res.json({
      customer_id: id,
      payment_terms_days: payment_terms_days,
      message: payment_terms_days === null
        ? "Payment terms cleared"
        : `Payment terms set to ${payment_terms_days === 0 ? "Due on receipt" : `Net ${payment_terms_days}`}`,
    })
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message })
  }
}
