import {
  InjectManager,
  MedusaService,
  MedusaContext,
} from "@medusajs/framework/utils"
import { Context } from "@medusajs/framework/types"
import { EntityManager } from "@mikro-orm/knex"
import Quote from "./models/quote"

class QuoteModuleService extends MedusaService({ Quote }) {
  /**
   * Get quotes for a specific customer with optional filters
   */
  @InjectManager()
  async getQuotesByCustomer(
    customerId: string,
    filters?: { status?: string },
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<any[]> {
    const conditions: string[] = ["customer_id = ?"]
    const params: any[] = [customerId]

    if (filters?.status) {
      conditions.push("status = ?")
      params.push(filters.status)
    }

    const result = await sharedContext?.manager?.execute(
      `SELECT * FROM quote WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params
    )

    return result ?? []
  }

  /**
   * Find quotes that have expired (status = "quoted" and expires_at < now)
   */
  @InjectManager()
  async getExpiredQuotes(
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<any[]> {
    const result = await sharedContext?.manager?.execute(
      `SELECT id, status FROM quote WHERE status IN ('quoted', 'accepted') AND expires_at IS NOT NULL AND expires_at < NOW()`
    )

    return result ?? []
  }

  /**
   * Batch-update quotes as ordered
   */
  @InjectManager()
  async markAsOrdered(
    quoteIds: string[],
    orderId: string,
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<void> {
    if (quoteIds.length === 0) return

    const placeholders = quoteIds.map(() => "?").join(", ")
    await sharedContext?.manager?.execute(
      `UPDATE quote SET status = 'ordered', ordered_at = NOW(), order_id = ? WHERE id IN (${placeholders})`,
      [orderId, ...quoteIds]
    )
  }
}

export default QuoteModuleService
