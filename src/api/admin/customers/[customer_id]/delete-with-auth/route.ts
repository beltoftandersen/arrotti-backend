import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { deleteCustomersWorkflow } from "@medusajs/medusa/core-flows"

/**
 * DELETE /admin/customers/:customer_id/delete-with-auth
 *
 * Deletes a customer AND their associated auth identity.
 * This ensures clean deletion without orphaned auth records.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { customer_id } = req.params
  const logger = req.scope.resolve("logger")

  try {
    // 1. Get customer email before deletion
    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const customer = await customerModule.retrieveCustomer(customer_id)

    if (!customer) {
      res.status(404).json({ message: "Customer not found" })
      return
    }

    const email = customer.email

    // 2. Find auth identity by email
    const authModule = req.scope.resolve(Modules.AUTH)
    let authIdentityId: string | null = null

    try {
      // List all auth identities and find the one matching this email
      const authIdentities = await authModule.listAuthIdentities({})

      for (const authIdentity of authIdentities) {
        // Check if this auth identity has a provider identity with this email
        if (authIdentity.provider_identities) {
          for (const pi of authIdentity.provider_identities) {
            if (pi.entity_id === email && pi.provider === "emailpass") {
              authIdentityId = authIdentity.id
              break
            }
          }
        }
        if (authIdentityId) break
      }
    } catch (e) {
      logger.warn(`[Customer Delete] Could not find auth identity for ${email}: ${(e as Error).message}`)
    }

    // 3. Delete the customer using Medusa workflow
    await deleteCustomersWorkflow(req.scope).run({
      input: { ids: [customer_id] },
    })

    logger.info(`[Customer Delete] Deleted customer ${customer_id} (${email})`)

    // 4. Delete the auth identity if found
    if (authIdentityId) {
      await authModule.deleteAuthIdentities([authIdentityId])
      logger.info(`[Customer Delete] Deleted auth identity ${authIdentityId} for ${email}`)
    }

    res.status(200).json({
      id: customer_id,
      object: "customer",
      deleted: true,
      auth_identity_deleted: !!authIdentityId,
    })
  } catch (error: any) {
    logger.error(`[Customer Delete] Error: ${error.message}`)
    res.status(500).json({
      message: "Failed to delete customer",
      error: error.message,
    })
  }
}
