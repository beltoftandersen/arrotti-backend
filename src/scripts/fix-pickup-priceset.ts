import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function fixPickupPriceSet({ container }: ExecArgs) {
  const pricingModule = container.resolve(Modules.PRICING)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const pickupOptionId = "so_01KG4VFNJP57T4KG3MW6ZTD7J1"

  // Find existing link
  const linkRows = await db.raw(
    `SELECT * FROM shipping_option_price_set WHERE shipping_option_id = ?`,
    [pickupOptionId]
  )
  console.log("Existing link rows:", JSON.stringify(linkRows.rows, null, 2))

  if (linkRows.rows.length > 0) {
    const existingPriceSetId = linkRows.rows[0].price_set_id
    console.log(`Found linked price_set_id: ${existingPriceSetId}`)

    // Check if the price set actually exists
    try {
      const ps = await pricingModule.retrievePriceSet(existingPriceSetId)
      console.log(`Price set exists: ${ps.id}`)

      // Check prices
      const prices = await pricingModule.listPrices({ price_set_id: [existingPriceSetId] })
      console.log(`Prices in set: ${prices.length}`)
      for (const p of prices) {
        console.log(`  ${p.currency_code}: ${p.amount}`)
      }

      if (prices.length === 0) {
        // Add a default price
        await pricingModule.addPrices({
          priceSetId: existingPriceSetId,
          prices: [{ amount: 0, currency_code: "usd" }],
        })
        console.log("Added default $0 USD price")
      }
    } catch (e: any) {
      console.log(`Price set NOT found: ${e.message}`)
      console.log("Deleting stale link and creating new price set...")

      // Delete stale link
      await db.raw(
        `DELETE FROM shipping_option_price_set WHERE shipping_option_id = ?`,
        [pickupOptionId]
      )

      // Create new price set
      const priceSet = await pricingModule.createPriceSets({
        prices: [{ amount: 0, currency_code: "usd" }],
      })
      console.log(`Created price set: ${priceSet.id}`)

      // Create new link
      await remoteLink.create({
        [Modules.FULFILLMENT]: { shipping_option_id: pickupOptionId },
        [Modules.PRICING]: { price_set_id: priceSet.id },
      })
      console.log("Linked successfully!")
    }
  } else {
    console.log("No link found. Creating price set and link...")
    const priceSet = await pricingModule.createPriceSets({
      prices: [{ amount: 0, currency_code: "usd" }],
    })
    await remoteLink.create({
      [Modules.FULFILLMENT]: { shipping_option_id: pickupOptionId },
      [Modules.PRICING]: { price_set_id: priceSet.id },
    })
    console.log(`Created and linked price set: ${priceSet.id}`)
  }

  console.log("Done! Try setting the pickup price in the admin now.")
}
