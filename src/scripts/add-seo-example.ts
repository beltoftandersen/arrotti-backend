import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function addSeoExample({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)

  // Find the T-Shirt product
  const products = await productService.listProducts(
    { handle: "t-shirt" },
    { take: 1 }
  )

  if (!products.length) {
    console.log("Product 't-shirt' not found")
    return
  }

  const product = products[0]
  console.log(`Found product: ${product.title} (${product.id})`)

  // Update with SEO metadata
  const seoMetadata = {
    ...((product.metadata as Record<string, unknown>) || {}),
    seo_title: "Premium Medusa T-Shirt | Comfortable Cotton Tee",
    seo_description:
      "Shop the official Medusa T-Shirt. Made from 100% organic cotton, this comfortable tee features the iconic Medusa logo. Perfect for developers and e-commerce enthusiasts. Free shipping on orders over $50.",
    seo_keywords:
      "medusa t-shirt, developer t-shirt, e-commerce merchandise, cotton tee, medusa logo shirt",
  }

  await productService.updateProducts(product.id, {
    metadata: seoMetadata,
  })

  console.log("\nSEO metadata added successfully!")
  console.log("---")
  console.log(`seo_title: ${seoMetadata.seo_title}`)
  console.log(`seo_description: ${seoMetadata.seo_description}`)
  console.log(`seo_keywords: ${seoMetadata.seo_keywords}`)
  console.log("---")
  console.log(`\nView the product at: /products/t-shirt`)
}
