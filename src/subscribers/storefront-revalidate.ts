import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

async function revalidateStorefront(tags: string[]) {
  const storefrontUrl = process.env.STOREFRONT_URL

  if (!storefrontUrl) {
    console.warn("STOREFRONT_URL not set, skipping revalidation")
    return
  }

  try {
    const response = await fetch(`${storefrontUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.REVALIDATE_SECRET && {
          "x-revalidate-secret": process.env.REVALIDATE_SECRET,
        }),
      },
      body: JSON.stringify({ tags }),
    })

    if (response.ok) {
      console.log(`Storefront revalidated for tags: ${tags.join(", ")}`)
    } else {
      console.error(`Failed to revalidate storefront: ${response.status}`)
    }
  } catch (error) {
    console.error("Error revalidating storefront:", error)
  }
}

// Handle inventory level changes (stock updates)
export async function inventoryLevelHandler({
  event: { data },
}: SubscriberArgs<{ id: string }>) {
  await revalidateStorefront(["products"])
}

// Handle product updates
export async function productUpdatedHandler({
  event: { data },
}: SubscriberArgs<{ id: string }>) {
  await revalidateStorefront(["products"])
}

// Export default handler for the primary event
export default inventoryLevelHandler

export const config: SubscriberConfig = {
  event: [
    "inventory-level.created",
    "inventory-level.updated",
    "inventory-level.deleted",
    "product.updated",
    "product.created",
    "product.deleted",
  ],
}
