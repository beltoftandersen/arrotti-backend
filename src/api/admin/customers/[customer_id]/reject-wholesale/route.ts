import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type RejectWholesaleBody = {
  reason?: string
}

/**
 * POST /admin/customers/:customer_id/reject-wholesale
 *
 * Rejects a wholesale customer application by:
 * 1. Updating their metadata to mark as rejected
 * 2. Emitting a custom event to trigger rejection email
 */
export async function POST(
  req: AuthenticatedMedusaRequest<RejectWholesaleBody>,
  res: MedusaResponse
): Promise<void> {
  const { customer_id } = req.params
  const { reason } = req.body || {}
  const logger = req.scope.resolve("logger")
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const customerModule = req.scope.resolve(Modules.CUSTOMER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)

  try {
    // 1. Get customer details
    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name", "last_name", "company_name", "metadata"],
      filters: { id: customer_id },
    })

    if (!customer) {
      res.status(404).json({
        message: "Customer not found",
      })
      return
    }

    const metadata = customer.metadata as Record<string, any> | null

    // Check if already rejected
    if (metadata?.rejected_at) {
      res.status(400).json({
        message: "Customer application has already been rejected",
        customer_id: customer_id,
      })
      return
    }

    // Check if already approved
    if (metadata?.approved_at) {
      res.status(400).json({
        message: "Customer has already been approved. Cannot reject an approved customer.",
        customer_id: customer_id,
      })
      return
    }

    // 2. Update customer metadata
    const existingMetadata = metadata || {}
    await customerModule.updateCustomers(customer_id, {
      metadata: {
        ...existingMetadata,
        pending_approval: false,
        rejected_at: new Date().toISOString(),
        rejected_by: req.auth_context?.actor_id || "system",
        rejection_reason: reason || "Your application did not meet our wholesale requirements.",
      },
    })

    // 3. Emit custom event for rejection email
    await eventBus.emit({
      name: "customer.wholesale_rejected",
      data: {
        id: customer_id,
        reason: reason || "Your application did not meet our wholesale requirements.",
      },
    })

    logger.info(
      `[Wholesale Rejection] Customer ${customer_id} (${customer.email}) rejected for wholesale access`
    )

    res.status(200).json({
      success: true,
      message: "Customer application rejected",
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        company_name: customer.company_name,
        rejected_at: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    logger.error(
      `[Wholesale Rejection] Error rejecting customer ${customer_id}: ${error.message}`
    )

    res.status(500).json({
      message: "Failed to reject customer",
      error: error.message,
    })
  }
}
