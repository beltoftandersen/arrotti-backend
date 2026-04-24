import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const B2B_APPROVED_GROUP_ID = "cusgroup_b2b_approved"

type ApprovalStatus = "approved" | "pending" | "rejected"

/**
 * GET /store/customers/me/approved
 * Returns the authenticated customer's B2B approval state.
 *
 * - approved: in the B2B Approved group.
 * - rejected: metadata.rejected_at is set (and not approved).
 * - pending:  neither of the above.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ approved: false, status: "pending", message: "Not authenticated" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: groupMemberships } = await query.graph({
    entity: "customer_group_customer",
    fields: ["id", "customer_group_id"],
    filters: {
      customer_id: customerId,
      customer_group_id: B2B_APPROVED_GROUP_ID,
    },
  })

  const isApproved = groupMemberships.length > 0

  let status: ApprovalStatus = isApproved ? "approved" : "pending"
  let rejectionReason: string | undefined

  if (!isApproved) {
    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: ["id", "metadata"],
      filters: { id: customerId },
    })
    const metadata = (customer?.metadata as Record<string, any> | null) || {}
    if (metadata.rejected_at && !metadata.approved_at) {
      status = "rejected"
      if (typeof metadata.rejection_reason === "string") {
        rejectionReason = metadata.rejection_reason
      }
    }
  }

  res.json({
    approved: isApproved,
    status,
    rejection_reason: rejectionReason,
    customer_id: customerId,
  })
}
