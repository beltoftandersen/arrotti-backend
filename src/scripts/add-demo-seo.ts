import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function addDemoSeo({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)

  // Get first few products
  const products = await productService.listProducts({}, { take: 5 })

  if (!products.length) {
    console.log("No products found")
    return
  }

  const product = products[0]
  console.log(`Adding demo SEO to product: ${product.title} (${product.handle})`)

  // Update product with SEO metadata
  await productService.updateProducts(product.id, {
    metadata: {
      ...((product.metadata as Record<string, unknown>) || {}),
      seo_title: `${product.title} - Premium Auto Parts | Free Shipping`,
      seo_description: `Shop ${product.title} at the best price. High-quality OEM and aftermarket auto parts with fast shipping. Fits multiple vehicle makes and models. 30-day returns.`,
      seo_keywords: `${product.title}, auto parts, car parts, OEM parts, aftermarket parts, vehicle parts`,
    },
  })

  console.log("Demo SEO metadata added successfully!")
  console.log("\nMetadata preview:")
  console.log(`  seo_title: "${product.title} - Premium Auto Parts | Free Shipping"`)
  console.log(`  seo_description: "Shop ${product.title} at the best price..."`)
  console.log(`  seo_keywords: "${product.title}, auto parts, car parts..."`)

  // Verify the update
  const updated = await productService.retrieveProduct(product.id)
  console.log("\nUpdated metadata:", JSON.stringify(updated.metadata, null, 2))
}
