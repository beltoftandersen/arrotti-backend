import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import FitmentModuleService from "../modules/fitment/service"
import { FITMENT_MODULE } from "../modules/fitment"

const PRODUCT_COUNT = 30
const FITMENTS_PER_VEHICLE = 4

type FakerLike = {
  commerce: {
    productName: () => string
    productDescription: () => string
  }
  helpers: {
    slugify: (value: string) => string
    arrayElements: <T>(items: T[], count: number) => T[]
  }
  number: {
    int: (input: { min: number; max: number }) => number
  }
}

const buildProductInput = (
  faker: FakerLike,
  index: number,
  shippingProfileId: string
) => {
  const title = faker.commerce.productName()
  const handleBase = faker.helpers.slugify(title).toLowerCase()

  return {
    title,
    handle: `fitment-demo-${index}-${handleBase}`,
    description: faker.commerce.productDescription(),
    status: ProductStatus.PUBLISHED,
    shipping_profile_id: shippingProfileId,
    options: [
      {
        title: "Fit",
        values: ["Standard"],
      },
    ],
    variants: [
      {
        title: "Standard",
        sku: `FITMENT-${index}`,
        options: {
          Fit: "Standard",
        },
        prices: [
          {
            amount: faker.number.int({ min: 1500, max: 20000 }),
            currency_code: "usd",
          },
          {
            amount: faker.number.int({ min: 1500, max: 20000 }),
            currency_code: "eur",
          },
        ],
      },
    ],
  }
}

export default async function seedFitmentDemo({ container }: ExecArgs) {
  const { faker } = await import("@faker-js/faker")
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)
  const fitmentModuleService: FitmentModuleService = container.resolve(
    FITMENT_MODULE
  )

  const [shippingProfile] = await fulfillmentModuleService.listShippingProfiles(
    {}
  )

  if (!shippingProfile) {
    logger.error(
      "No shipping profiles found. Create one before running seed-fitment-demo."
    )
    return
  }

  logger.info("Creating demo products for fitment...")
  const productInputs = Array.from({ length: PRODUCT_COUNT }).map((_, index) =>
    buildProductInput(faker, index + 1, shippingProfile.id)
  )

  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: productInputs,
    },
  })

  logger.info("Creating vehicle makes, models, and vehicles...")
  const [toyota, vw, bmw] = await fitmentModuleService.createVehicleMakes([
    { name: "Toyota" },
    { name: "VW" },
    { name: "BMW" },
  ])

  const [camry, golf, series3] = await fitmentModuleService.createVehicleModels([
    { make_id: toyota.id, name: "Camry" },
    { make_id: vw.id, name: "Golf" },
    { make_id: bmw.id, name: "3 Series" },
  ])

  const vehicles = await fitmentModuleService.createVehicles([
    { make_id: toyota.id, model_id: camry.id, year_start: 2018, year_end: 2018 },
    { make_id: toyota.id, model_id: camry.id, year_start: 2019, year_end: 2019 },
    { make_id: toyota.id, model_id: camry.id, year_start: 2020, year_end: 2020 },
    { make_id: vw.id, model_id: golf.id, year_start: 2016, year_end: 2016 },
    { make_id: vw.id, model_id: golf.id, year_start: 2017, year_end: 2017 },
    { make_id: vw.id, model_id: golf.id, year_start: 2018, year_end: 2018 },
    { make_id: bmw.id, model_id: series3.id, year_start: 2015, year_end: 2015 },
    { make_id: bmw.id, model_id: series3.id, year_start: 2016, year_end: 2016 },
  ])

  logger.info("Creating fitments and linking products...")
  const fitmentInputs: { vehicle_id: string; submodels: Record<string, unknown>; features: Record<string, unknown>; notes?: string }[] = []
  const fitmentProductIds: string[] = []

  for (const vehicle of vehicles) {
    const selectedProducts = faker.helpers.arrayElements(
      products,
      FITMENTS_PER_VEHICLE
    )

    for (const product of selectedProducts) {
      fitmentInputs.push({
        vehicle_id: vehicle.id,
        submodels: [] as unknown as Record<string, unknown>,
        features: [] as unknown as Record<string, unknown>,
        notes: faker.lorem.sentence(),
      })
      fitmentProductIds.push(product.id)
    }
  }

  const fitments = await fitmentModuleService.createFitments(fitmentInputs)

  for (let i = 0; i < fitments.length; i++) {
    await link.create({
      [Modules.PRODUCT]: { product_id: fitmentProductIds[i] },
      fitment: { fitment_id: fitments[i].id },
    })
  }

  logger.info("Finished seeding fitment demo data.")
}
