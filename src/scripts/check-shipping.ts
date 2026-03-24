import { ExecArgs } from "@medusajs/framework/types"

export default async function checkShipping({ container }: ExecArgs) {
  const query = container.resolve("query")

  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "price_type", "amount", "service_zone.*", "service_zone.fulfillment_set.*"],
  })

  for (const so of options) {
    const type = (so as any).service_zone?.fulfillment_set?.type || "?"
    console.log(`${so.id} | ${so.name} | ${type} | ${so.price_type} | amount=${so.amount}`)
  }

  // Check price sets
  const pricingModule = container.resolve("pricing")
  for (const so of options) {
    try {
      const priceSets = await pricingModule.listPriceSets({ id: [so.id] })
      console.log(`  PriceSet for ${so.id}: ${priceSets.length > 0 ? priceSets[0].id : "NOT FOUND"}`)
    } catch (e: any) {
      console.log(`  PriceSet for ${so.id}: ERROR - ${e.message}`)
    }
  }
}
