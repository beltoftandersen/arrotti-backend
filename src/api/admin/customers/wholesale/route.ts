import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/customers/wholesale
 *
 * Lists all customers with wholesale registration metadata.
 * Supports filtering by status (pending, approved, rejected).
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const status = req.query.status as string | undefined

  try {
    // Get registered customers only (has_account filters out guests)
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "email",
        "first_name",
        "last_name",
        "company_name",
        "phone",
        "metadata",
        "created_at",
      ],
      filters: {
        has_account: true,
      },
    })

    // Filter to only wholesale customers (those with registration_source or pending_approval metadata)
    const wholesaleCustomers = customers.filter((customer: any) => {
      const metadata = customer.metadata as Record<string, any> | null
      if (!metadata) return false

      // Check if this is a wholesale registration
      const isWholesale =
        metadata.registration_source === "wholesale_portal" ||
        metadata.registration_source === "wholesale" ||
        metadata.pending_approval !== undefined ||
        metadata.tax_id !== undefined ||
        metadata.approved_at !== undefined ||
        metadata.rejected_at !== undefined

      if (!isWholesale) return false

      // Apply status filter if provided
      if (status) {
        const isPending = metadata.pending_approval === true
        const isApproved = metadata.approved_at && !metadata.rejected_at
        const isRejected = !!metadata.rejected_at

        switch (status) {
          case "pending":
            return isPending
          case "approved":
            return isApproved
          case "rejected":
            return isRejected
          default:
            return true
        }
      }

      return true
    })

    // Sort by created_at descending (newest first)
    wholesaleCustomers.sort((a: any, b: any) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    // Transform for response
    const result = wholesaleCustomers.map((customer: any) => {
      const metadata = customer.metadata as Record<string, any> || {}

      let approvalStatus: "pending" | "approved" | "rejected" = "pending"
      if (metadata.rejected_at) {
        approvalStatus = "rejected"
      } else if (metadata.approved_at) {
        approvalStatus = "approved"
      } else if (metadata.pending_approval === true) {
        approvalStatus = "pending"
      }

      return {
        id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        company_name: customer.company_name,
        phone: customer.phone,
        tax_id: metadata.tax_id || null,
        status: approvalStatus,
        applied_at: metadata.registration_date || customer.created_at,
        approved_at: metadata.approved_at || null,
        rejected_at: metadata.rejected_at || null,
        rejection_reason: metadata.rejection_reason || null,
        documents_count: metadata.tax_documents?.length || 0,
      }
    })

    res.status(200).json({
      customers: result,
      count: result.length,
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch wholesale customers",
      error: error.message,
    })
  }
}
