import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

type CustomerDeletedData = {
  id: string
  email?: string
  // Medusa might include more fields from the deleted customer
  [key: string]: unknown
}

/**
 * Subscriber for customer deletion.
 * Cleans up the associated auth identity when a customer is deleted.
 */
export default async function customerDeletedHandler({
  event: { data },
  container,
}: SubscriberArgs<CustomerDeletedData>) {
  const logger = container.resolve("logger")
  const authModule = container.resolve(Modules.AUTH)

  logger.info(`[Customer Deleted] Processing deletion for customer ${data.id}, email: ${data.email || "not provided"}`)

  try {
    let authIdentityId: string | null = null

    // Method 1: If email is provided in the event data, find auth identity by email
    if (data.email) {
      const authIdentities = await authModule.listAuthIdentities({}, {
        relations: ["provider_identities"],
      })

      for (const ai of authIdentities) {
        if (ai.provider_identities) {
          for (const pi of ai.provider_identities) {
            if (pi.entity_id === data.email && pi.provider === "emailpass") {
              authIdentityId = ai.id
              break
            }
          }
        }
        if (authIdentityId) break
      }
    }

    // Method 2: Find auth identities with null customer_id (orphaned) that were just unlinked
    if (!authIdentityId) {
      const authIdentities = await authModule.listAuthIdentities({
        app_metadata: {
          customer_id: null,
        },
      }, {
        relations: ["provider_identities"],
      })

      // Look for one that was likely just orphaned
      // This is a fallback - ideally we have the email from method 1
      for (const ai of authIdentities) {
        // Check if this auth identity has provider_identities (meaning it's a real account)
        if (ai.provider_identities && ai.provider_identities.length > 0) {
          // For now, we'll log these but not delete them automatically
          // since we can't be 100% sure which one was just orphaned
          logger.info(`[Customer Deleted] Found orphaned auth identity: ${ai.id}`)
        }
      }
    }

    if (authIdentityId) {
      await authModule.deleteAuthIdentities([authIdentityId])
      logger.info(`[Customer Deleted] Cleaned up auth identity ${authIdentityId} for customer ${data.id}`)
    } else {
      logger.info(`[Customer Deleted] No auth identity found for customer ${data.id}`)
    }
  } catch (error) {
    logger.error(
      `[Customer Deleted] Error cleaning up auth identity for customer ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.deleted",
}
