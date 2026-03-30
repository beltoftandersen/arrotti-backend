import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const ALLOWED_ZIPS = [
  "32801", "32802", "32803", "32804", "32805", "32806", "32807", "32808",
  "32809", "32810", "32811", "32812", "32814", "32815", "32816", "32817",
  "32818", "32819", "32820", "32821", "32822", "32824", "32825", "32826",
  "32827", "32828", "32829", "32830", "32831", "32832", "32833", "32834",
  "32835", "32836", "32837", "32839", "32853", "32854", "32855", "32856",
  "32857", "32858", "32859", "32860", "32861", "32862", "32867", "32868",
  "32869", "32872", "32877", "32878", "32885", "32886", "32887", "32891",
  "32896", "32897", "32899",
  // Kissimmee / Osceola
  "34741", "34742", "34743", "34744", "34745", "34746", "34747", "34758",
  "34759", "34786", "34787", "34761", "34711", "34712", "34713", "34714",
  "34715",
  // Davenport / Haines City
  "33837", "33896", "33897",
  // St. Cloud
  "34769", "34771", "34772", "34773",
  // Altamonte / Seminole
  "32701", "32714", "32765", "32789", "32792",
]

export default async function updateLocalDeliveryZips({ container }: ExecArgs) {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  const zones = await fulfillmentModule.listServiceZones(
    { name: "Orlando Local Delivery" },
    { relations: ["geo_zones"] }
  )

  if (!zones.length) {
    console.log("Orlando Local Delivery zone not found")
    return
  }

  const zone = zones[0]
  const existingGeoZones = (zone as any).geo_zones ?? []
  console.log(`Found zone: ${zone.id} with ${existingGeoZones.length} existing geo zones`)

  // Delete all existing geo zones
  for (const gz of existingGeoZones) {
    await fulfillmentModule.deleteGeoZones(gz.id)
  }
  console.log(`Deleted ${existingGeoZones.length} old geo zones`)

  // Create new geo zones for allowed zips
  const geoZones = ALLOWED_ZIPS.map((zip) => ({
    type: "zip" as const,
    country_code: "us",
    province_code: "FL",
    city: "*",
    postal_expression: zip,
  }))

  await fulfillmentModule.createGeoZones(
    geoZones.map((gz) => ({
      ...gz,
      service_zone_id: zone.id,
    })) as any
  )

  console.log(`Created ${ALLOWED_ZIPS.length} new geo zones`)
  console.log(`\nDone! Free Local Delivery now covers ${ALLOWED_ZIPS.length} zip codes.`)
}
