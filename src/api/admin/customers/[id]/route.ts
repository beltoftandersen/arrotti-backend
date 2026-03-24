import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * DELETE /admin/customers/:id
 *
 * Override Medusa's default customer delete to handle auth identity cleanup.
 * This prevents "Auth identity not found" errors.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { id: customerId } = req.params
  const logger = req.scope.resolve("logger")
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // 1. Get customer details before deletion
    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const customer = await customerModule.retrieveCustomer(customerId).catch(() => null)

    if (!customer) {
      res.status(404).json({ message: "Customer not found" })
      return
    }

    const email = customer.email
    logger.info(`[Customer Delete] Starting deletion of customer ${customerId} (${email})`)

    // 2. Find and delete auth identity by email BEFORE deleting customer
    const authModule = req.scope.resolve(Modules.AUTH)
    let authIdentityDeleted = false

    try {
      const authIdentities = await authModule.listAuthIdentities({}, {
        relations: ["provider_identities"],
      })

      for (const ai of authIdentities) {
        if (ai.provider_identities) {
          for (const pi of ai.provider_identities) {
            if (pi.entity_id === email && pi.provider === "emailpass") {
              await authModule.deleteAuthIdentities([ai.id])
              authIdentityDeleted = true
              logger.info(`[Customer Delete] Deleted auth identity ${ai.id} for ${email}`)
              break
            }
          }
        }
        if (authIdentityDeleted) break
      }
    } catch (e) {
      logger.warn(`[Customer Delete] Auth identity cleanup warning: ${(e as Error).message}`)
      // Continue even if auth cleanup fails
    }

    // 3. Remove customer from any groups
    try {
      const { data: groupMemberships } = await query.graph({
        entity: "customer_group_customer",
        fields: ["id", "customer_group_id"],
        filters: { customer_id: customerId },
      })

      if (groupMemberships.length > 0) {
        for (const membership of groupMemberships) {
          await customerModule.removeCustomerFromGroup({
            customer_id: customerId,
            customer_group_id: membership.customer_group_id,
          })
        }
        logger.info(`[Customer Delete] Removed customer from ${groupMemberships.length} group(s)`)
      }
    } catch (e) {
      logger.warn(`[Customer Delete] Group cleanup warning: ${(e as Error).message}`)
    }

    // 4. Delete garage vehicles if any
    try {
      const garageModule = req.scope.resolve("garage")
      if (garageModule && typeof garageModule.listGarageVehicles === "function") {
        const garageVehicles = await garageModule.listGarageVehicles({
          customer_id: customerId,
        })
        if (garageVehicles.length > 0) {
          await garageModule.deleteGarageVehicles(garageVehicles.map((v: any) => v.id))
          logger.info(`[Customer Delete] Deleted ${garageVehicles.length} garage vehicle(s)`)
        }
      }
    } catch (e) {
      logger.warn(`[Customer Delete] Garage cleanup warning: ${(e as Error).message}`)
    }

    // 5. Delete the customer record
    await customerModule.deleteCustomers([customerId])
    logger.info(`[Customer Delete] Successfully deleted customer ${customerId}`)

    res.status(200).json({
      id: customerId,
      object: "customer",
      deleted: true,
      auth_identity_deleted: authIdentityDeleted,
    })
  } catch (error: any) {
    logger.error(`[Customer Delete] Error: ${error.message}`)
    res.status(500).json({
      message: "Failed to delete customer",
      error: error.message,
    })
  }
}
