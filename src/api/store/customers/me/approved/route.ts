import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const B2B_APPROVED_GROUP_ID = "cusgroup_b2b_approved"

/**
 * GET /store/customers/me/approved
 * Check if the authenticated customer is approved for B2B access
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ approved: false, message: "Not authenticated" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Check if customer is in the B2B Approved group
  const { data: groupMemberships } = await query.graph({
    entity: "customer_group_customer",
    fields: ["id", "customer_group_id"],
    filters: {
      customer_id: customerId,
      customer_group_id: B2B_APPROVED_GROUP_ID,
    },
  })

  const isApproved = groupMemberships.length > 0

  res.json({
    approved: isApproved,
    customer_id: customerId,
  })
}
