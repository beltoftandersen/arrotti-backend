import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const B2B_APPROVED_GROUP_ID = "cusgroup_b2b_approved"

/**
 * POST /admin/customers/:customer_id/approve-wholesale
 *
 * Approves a wholesale customer by:
 * 1. Adding them to the "B2B Approved" customer group
 * 2. Updating their metadata to mark as approved
 * 3. Emitting a custom event to trigger approval email
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { customer_id } = req.params
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

    // Check if already approved
    const { data: existingMembership } = await query.graph({
      entity: "customer_group_customer",
      fields: ["id"],
      filters: {
        customer_id: customer_id,
        customer_group_id: B2B_APPROVED_GROUP_ID,
      },
    })

    if (existingMembership.length > 0) {
      res.status(400).json({
        message: "Customer is already approved",
        customer_id: customer_id,
      })
      return
    }

    // 2. Ensure B2B Approved group exists
    const { data: groups } = await query.graph({
      entity: "customer_group",
      fields: ["id", "name"],
      filters: { id: B2B_APPROVED_GROUP_ID },
    })

    if (groups.length === 0) {
      // Create the group if it doesn't exist
      logger.info(`[Wholesale Approval] Creating B2B Approved group`)
      await customerModule.createCustomerGroups({
        name: "B2B Approved",
        metadata: {
          id: B2B_APPROVED_GROUP_ID,
          description: "Approved wholesale customers",
        },
      })
    }

    // 3. Add customer to the B2B Approved group
    await customerModule.addCustomerToGroup({
      customer_id: customer_id,
      customer_group_id: B2B_APPROVED_GROUP_ID,
    })

    logger.info(
      `[Wholesale Approval] Added customer ${customer_id} to B2B Approved group`
    )

    // 4. Update customer metadata
    const existingMetadata = (customer.metadata as Record<string, any>) || {}
    await customerModule.updateCustomers(customer_id, {
      metadata: {
        ...existingMetadata,
        pending_approval: false,
        approved_at: new Date().toISOString(),
        approved_by: req.auth_context?.actor_id || "system",
      },
    })

    // 5. Emit custom event for approval email
    await eventBus.emit({
      name: "customer.wholesale_approved",
      data: {
        id: customer_id,
      },
    })

    logger.info(
      `[Wholesale Approval] Customer ${customer_id} (${customer.email}) approved for wholesale access`
    )

    res.status(200).json({
      success: true,
      message: "Customer approved for wholesale access",
      customer: {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        company_name: customer.company_name,
        approved_at: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    logger.error(
      `[Wholesale Approval] Error approving customer ${customer_id}: ${error.message}`
    )

    res.status(500).json({
      message: "Failed to approve customer",
      error: error.message,
    })
  }
}
