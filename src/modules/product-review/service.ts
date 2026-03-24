import {
  InjectManager,
  MedusaService,
  MedusaContext,
} from "@medusajs/framework/utils"
import { Context } from "@medusajs/framework/types"
import { EntityManager } from "@mikro-orm/knex"
import Review from "./models/review"

class ProductReviewModuleService extends MedusaService({ Review }) {
  /**
   * Get the average rating for a product (approved reviews only)
   */
  @InjectManager()
  async getAverageRating(
    productId: string,
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<number> {
    const result = await sharedContext?.manager?.execute(
      `SELECT AVG(rating) as average FROM review
       WHERE product_id = ? AND status = 'approved'`,
      [productId]
    )
    return parseFloat(parseFloat(result?.[0]?.average ?? 0).toFixed(2))
  }

  /**
   * Get review count for a product (approved reviews only)
   */
  @InjectManager()
  async getReviewCount(
    productId: string,
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<number> {
    const result = await sharedContext?.manager?.execute(
      `SELECT COUNT(*) as count FROM review
       WHERE product_id = ? AND status = 'approved'`,
      [productId]
    )
    return parseInt(result?.[0]?.count ?? 0, 10)
  }

  /**
   * Get average ratings for ALL products in one query (for reindex)
   */
  @InjectManager()
  async getAllAverageRatings(
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<Map<string, number>> {
    const result = await sharedContext?.manager?.execute(
      `SELECT product_id, AVG(rating) as average FROM review
       WHERE status = 'approved'
       GROUP BY product_id`
    )
    const map = new Map<string, number>()
    for (const row of result ?? []) {
      map.set(row.product_id, parseFloat(parseFloat(row.average).toFixed(2)))
    }
    return map
  }

  /**
   * Get rating distribution for a product (count per rating 1-5)
   */
  @InjectManager()
  async getRatingDistribution(
    productId: string,
    @MedusaContext() sharedContext?: Context<EntityManager>
  ): Promise<Record<number, number>> {
    const result = await sharedContext?.manager?.execute(
      `SELECT FLOOR(rating) as rating, COUNT(*) as count
       FROM review
       WHERE product_id = ? AND status = 'approved'
       GROUP BY FLOOR(rating)
       ORDER BY rating DESC`,
      [productId]
    )

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const row of result ?? []) {
      const rating = parseInt(row.rating, 10)
      if (rating >= 1 && rating <= 5) {
        distribution[rating] = parseInt(row.count, 10)
      }
    }
    return distribution
  }
}

export default ProductReviewModuleService
