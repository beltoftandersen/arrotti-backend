import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"
import BrandModuleService from "../modules/brand/service"

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/g, "")
    .replace(/^-+/g, "")

const DEMO_BRANDS = [
  {
    name: "Bosch",
    handle: "bosch",
    description: "German automotive parts manufacturer",
  },
  {
    name: "ACDelco",
    handle: "acdelco",
    description: "General Motors parts brand",
  },
  {
    name: "Denso",
    handle: "denso",
    description: "Japanese automotive components supplier",
  },
  {
    name: "NGK",
    handle: "ngk",
    description: "Spark plugs and ignition components",
  },
  {
    name: "Mobil 1",
    handle: "mobil-1",
    description: "Premium synthetic motor oil",
  },
  {
    name: "Brembo",
    handle: "brembo",
    description: "High-performance brake systems",
  },
  {
    name: "K&N",
    handle: "k-n",
    description: "Performance air filters",
  },
  {
    name: "Moog",
    handle: "moog",
    description: "Steering and suspension parts",
  },
  {
    name: "Monroe",
    handle: "monroe",
    description: "Shock absorbers and struts",
  },
  {
    name: "Bilstein",
    handle: "bilstein",
    description: "German shock absorber manufacturer",
  },
  {
    name: "Wagner",
    handle: "wagner",
    description: "Brake pads and lighting",
  },
  {
    name: "Motorcraft",
    handle: "motorcraft",
    description: "Ford OEM parts brand",
  },
  {
    name: "Castrol",
    handle: "castrol",
    description: "Motor oils and lubricants",
  },
  {
    name: "Champion",
    handle: "champion",
    description: "Spark plugs and wipers",
  },
  {
    name: "Fram",
    handle: "fram",
    description: "Filters for automotive applications",
  },
]

export default async function seedBrands({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

  logger.info("Seeding demo brands...")

  const existingBrands = await brandService.listBrands({})
  const existingNames = new Set(existingBrands.map((b) => b.name.toLowerCase()))

  const brandsToCreate = DEMO_BRANDS.filter(
    (brand) => !existingNames.has(brand.name.toLowerCase())
  )

  if (brandsToCreate.length === 0) {
    logger.info("All demo brands already exist. Skipping.")
    return
  }

  const createdBrands = await brandService.createBrands(brandsToCreate)

  const count = Array.isArray(createdBrands) ? createdBrands.length : 1
  logger.info(`Created ${count} demo brands.`)
  logger.info("Finished seeding brands.")
}
