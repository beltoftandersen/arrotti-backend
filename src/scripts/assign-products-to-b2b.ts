import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function assignProductsToB2B({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const link = container.resolve("remoteLink")

  const b2bChannelId = "sc_01KG816VXBCEYZT0PVG609XCN4"

  // Get all products
  const [products, count] = await productService.listAndCountProducts(
    {},
    { select: ["id"], take: null }
  )

  console.log(`Found ${count} products to assign to B2B channel`)

  // Link products to B2B channel in batches
  const batchSize = 500
  let linked = 0

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize)

    const links = batch.map((product) => ({
      [Modules.PRODUCT]: { product_id: product.id },
      [Modules.SALES_CHANNEL]: { sales_channel_id: b2bChannelId },
    }))

    try {
      await link.create(links)
      linked += batch.length
      console.log(`Linked ${linked}/${count} products...`)
    } catch (error: any) {
      // Some might already be linked, that's ok
      if (error.message?.includes("already exists")) {
        console.log(`Batch ${i}-${i + batchSize}: some already linked, continuing...`)
        linked += batch.length
      } else {
        console.error(`Error linking batch: ${error.message}`)
      }
    }
  }

  console.log(`\nDone! Assigned ${linked} products to B2B Wholesale channel.`)
}
