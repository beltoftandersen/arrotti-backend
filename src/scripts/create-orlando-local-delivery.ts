import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Creates an Orlando Local Delivery shipping option:
 * 1. Creates a service zone "Orlando Local Delivery" with zip geo zone (328xx)
 * 2. Creates a flat $0 shipping option "Free Local Delivery" using manual provider
 */
export default async function createOrlandoLocalDelivery({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  const pricingModule = container.resolve(Modules.PRICING)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

  // Find the existing shipping fulfillment set
  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: [
      "id",
      "name",
      "fulfillment_sets.id",
      "fulfillment_sets.type",
      "fulfillment_sets.name",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
    ],
  })

  const location = locations[0] as any
  if (!location) {
    console.log("No stock location found")
    return
  }
  console.log(`Location: ${location.name} (${location.id})`)

  const shippingFulfillmentSet = location.fulfillment_sets?.find(
    (fs: any) => fs.type === "shipping"
  )
  if (!shippingFulfillmentSet) {
    console.log("No shipping fulfillment set found")
    return
  }
  console.log(`Fulfillment set: ${shippingFulfillmentSet.name} (${shippingFulfillmentSet.id})`)

  // Check if Orlando zone already exists
  const existingZone = shippingFulfillmentSet.service_zones?.find(
    (sz: any) => sz.name === "Orlando Local Delivery"
  )
  if (existingZone) {
    console.log(`Orlando service zone already exists: ${existingZone.id}`)
    return
  }

  // Create service zone with zip geo zone for 328xx
  const serviceZone = await fulfillmentModule.createServiceZones({
    name: "Orlando Local Delivery",
    fulfillment_set_id: shippingFulfillmentSet.id,
    geo_zones: [
      {
        type: "zip",
        country_code: "us",
        province_code: "us-fl",
        city: "Orlando",
        postal_expression: { type: "regex", value: "^328\\d{2}" },
      } as any,
    ],
  })
  console.log(`Created service zone: ${serviceZone.id}`)

  // Find shipping profile
  const profiles = await fulfillmentModule.listShippingProfiles({})
  const defaultProfile = profiles[0]
  if (!defaultProfile) {
    console.log("No shipping profile found")
    return
  }
  console.log(`Using shipping profile: ${defaultProfile.name} (${defaultProfile.id})`)

  // Find manual fulfillment provider
  const providers = await fulfillmentModule.listFulfillmentProviders({})
  const manualProvider = providers.find((p: any) => p.id.includes("manual"))
  if (!manualProvider) {
    console.log("No manual fulfillment provider found. Available:", providers.map((p: any) => p.id))
    return
  }
  console.log(`Using provider: ${manualProvider.id}`)

  // Create shipping option
  const shippingOption = await fulfillmentModule.createShippingOptions({
    name: "Free Local Delivery",
    price_type: "flat",
    service_zone_id: serviceZone.id,
    shipping_profile_id: defaultProfile.id,
    provider_id: manualProvider.id,
    type: {
      label: "Local Delivery",
      description: "Free delivery within Orlando area",
      code: "local-delivery",
    },
    rules: [],
  })
  console.log(`Created shipping option: ${shippingOption.id}`)

  // Create price set with $0
  const priceSet = await pricingModule.createPriceSets({
    prices: [{ amount: 0, currency_code: "usd" }],
  })
  console.log(`Created price set: ${priceSet.id}`)

  // Link shipping option to price set
  await remoteLink.create({
    [Modules.FULFILLMENT]: { shipping_option_id: shippingOption.id },
    [Modules.PRICING]: { price_set_id: priceSet.id },
  })
  console.log(`Linked shipping option to price set`)

  console.log("\nDone! Free Local Delivery option created for Orlando (328xx zip codes).")
}
