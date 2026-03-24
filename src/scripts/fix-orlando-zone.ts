import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function fixOrlandoZone({ container }: ExecArgs) {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  // Delete the old zone with regex postal_expression
  const zones = await fulfillmentModule.listServiceZones(
    { name: "Orlando Local Delivery" },
    { relations: ["geo_zones"] }
  )

  if (zones.length > 0) {
    const zone = zones[0]
    console.log(`Deleting old zone: ${zone.id}`)
    // Delete geo zones first
    for (const gz of (zone as any).geo_zones ?? []) {
      await fulfillmentModule.deleteGeoZones(gz.id)
    }
    // Delete shipping options in this zone
    const options = await fulfillmentModule.listShippingOptions({ service_zone_id: zone.id })
    for (const o of options) {
      await fulfillmentModule.deleteShippingOptions(o.id)
      console.log(`Deleted shipping option: ${o.name} (${o.id})`)
    }
    await fulfillmentModule.deleteServiceZones(zone.id)
    console.log("Deleted old zone")
  }

  // Find the shipping fulfillment set
  const sets = await fulfillmentModule.listFulfillmentSets({ type: "shipping" })
  const shippingSet = sets[0]
  if (!shippingSet) { console.log("No shipping fulfillment set"); return }

  // Generate 328xx zip codes (32800-32899)
  const zipCodes: string[] = []
  for (let i = 0; i <= 99; i++) {
    zipCodes.push(`328${String(i).padStart(2, "0")}`)
  }

  // Create new zone with individual zip geo zones
  const geoZones = zipCodes.map((zip) => ({
    type: "zip" as const,
    country_code: "us",
    province_code: "us-fl",
    city: "Orlando",
    postal_expression: zip,
  }))

  const zone = await fulfillmentModule.createServiceZones({
    name: "Orlando Local Delivery",
    fulfillment_set_id: shippingSet.id,
    geo_zones: geoZones as any,
  })
  console.log(`Created zone: ${zone.id} with ${zipCodes.length} zip codes`)

  // Find shipping profile + manual provider
  const profiles = await fulfillmentModule.listShippingProfiles({})
  const providers = await fulfillmentModule.listFulfillmentProviders({})
  const manualProvider = providers.find((p: any) => p.id.includes("manual"))

  // Create shipping option
  const option = await fulfillmentModule.createShippingOptions({
    name: "Free Local Delivery",
    price_type: "flat",
    service_zone_id: zone.id,
    shipping_profile_id: profiles[0].id,
    provider_id: manualProvider!.id,
    type: { label: "Local Delivery", description: "Free delivery within Orlando", code: "local-delivery" },
    rules: [],
  })
  console.log(`Created option: ${option.id}`)

  // Create price set + link
  const pricingModule = container.resolve(Modules.PRICING)
  const remoteLink = container.resolve("remoteLink")
  const priceSet = await pricingModule.createPriceSets({ prices: [{ amount: 0, currency_code: "usd" }] })
  await remoteLink.create({
    [Modules.FULFILLMENT]: { shipping_option_id: option.id },
    [Modules.PRICING]: { price_set_id: priceSet.id },
  })
  console.log(`Linked price set ($0)`)
  console.log("\nDone! Free Local Delivery with 100 individual zip codes.")
}
