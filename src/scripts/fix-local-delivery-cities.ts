import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

/**
 * Fix the Orlando Local Delivery geo zones by setting the correct USPS city
 * for each zip code (replacing the non-functional city: "*").
 *
 * Also creates duplicate geo zones for common city name variations
 * (e.g. "Saint Cloud" vs "St Cloud" vs "St. Cloud").
 */

// Map each zip to its USPS-preferred city name
const ZIP_CITY_MAP: Record<string, string> = {
  // Orlando
  "32801": "Orlando", "32802": "Orlando", "32803": "Orlando", "32804": "Orlando",
  "32805": "Orlando", "32806": "Orlando", "32807": "Orlando", "32808": "Orlando",
  "32809": "Orlando", "32810": "Orlando", "32811": "Orlando", "32812": "Orlando",
  "32814": "Orlando", "32815": "Orlando", "32816": "Orlando", "32817": "Orlando",
  "32818": "Orlando", "32819": "Orlando", "32820": "Orlando", "32821": "Orlando",
  "32822": "Orlando", "32824": "Orlando", "32825": "Orlando", "32826": "Orlando",
  "32827": "Orlando", "32828": "Orlando", "32829": "Orlando", "32830": "Orlando",
  "32831": "Orlando", "32832": "Orlando", "32833": "Orlando", "32834": "Orlando",
  "32835": "Orlando", "32836": "Orlando", "32837": "Orlando", "32839": "Orlando",
  "32853": "Orlando", "32854": "Orlando", "32855": "Orlando", "32856": "Orlando",
  "32857": "Orlando", "32858": "Orlando", "32859": "Orlando", "32860": "Orlando",
  "32861": "Orlando", "32862": "Orlando", "32867": "Orlando", "32868": "Orlando",
  "32869": "Orlando", "32872": "Orlando", "32877": "Orlando", "32878": "Orlando",
  "32885": "Orlando", "32886": "Orlando", "32887": "Orlando", "32891": "Orlando",
  "32896": "Orlando", "32897": "Orlando", "32899": "Orlando",
  // Kissimmee / Osceola
  "34741": "Kissimmee", "34742": "Kissimmee", "34743": "Kissimmee",
  "34744": "Kissimmee", "34745": "Kissimmee", "34746": "Kissimmee",
  "34747": "Kissimmee", "34758": "Kissimmee", "34759": "Kissimmee",
  // Windermere / Winter Garden / Ocoee / Clermont
  "34786": "Windermere", "34787": "Winter Garden", "34761": "Ocoee",
  "34711": "Clermont", "34712": "Clermont", "34713": "Clermont",
  "34714": "Clermont", "34715": "Clermont",
  // Davenport
  "33837": "Davenport", "33896": "Davenport", "33897": "Davenport",
  // Saint Cloud
  "34769": "Saint Cloud", "34771": "Saint Cloud",
  "34772": "Saint Cloud", "34773": "Saint Cloud",
  // Altamonte Springs / Oviedo / Winter Park
  "32701": "Altamonte Springs", "32714": "Altamonte Springs",
  "32765": "Oviedo", "32789": "Winter Park", "32792": "Winter Park",
}

// City name variations to also accept (zip → additional city names)
const CITY_VARIATIONS: Record<string, string[]> = {
  "Saint Cloud": ["St Cloud", "St. Cloud"],
  "Altamonte Springs": ["Altamonte Spgs", "Altamonte"],
  "Winter Garden": ["Wtr Garden"],
  "Winter Park": ["Wtr Park"],
}

export default async function fixLocalDeliveryCities({ container }: ExecArgs) {
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

  // Build new geo zones: primary city + variations
  const geoZones: Array<{
    type: "zip"
    country_code: string
    province_code: string
    city: string
    postal_expression: string
  }> = []

  for (const [zip, city] of Object.entries(ZIP_CITY_MAP)) {
    // Primary city name
    geoZones.push({
      type: "zip",
      country_code: "us",
      province_code: "FL",
      city,
      postal_expression: zip,
    })

    // Add variations if any
    const variations = CITY_VARIATIONS[city]
    if (variations) {
      for (const variant of variations) {
        geoZones.push({
          type: "zip",
          country_code: "us",
          province_code: "FL",
          city: variant,
          postal_expression: zip,
        })
      }
    }
  }

  // Create all geo zones
  await fulfillmentModule.createGeoZones(
    geoZones.map((gz) => ({
      ...gz,
      service_zone_id: zone.id,
    })) as any
  )

  // Summary
  const cityCount: Record<string, number> = {}
  for (const gz of geoZones) {
    cityCount[gz.city] = (cityCount[gz.city] || 0) + 1
  }
  console.log(`\nCreated ${geoZones.length} geo zones:`)
  for (const [city, count] of Object.entries(cityCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${city}: ${count} zips`)
  }
  console.log(`\nDone!`)
}
