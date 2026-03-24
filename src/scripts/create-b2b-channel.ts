import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function createB2BChannel({ container }: ExecArgs) {
  const salesChannelService = container.resolve("sales_channel")
  const apiKeyService = container.resolve("api_key")
  const linkService = container.resolve(ContainerRegistrationKeys.LINK)

  // Check if B2B channel already exists
  const existingChannels = await salesChannelService.listSalesChannels({
    name: "B2B Wholesale"
  })

  let b2bChannel
  if (existingChannels.length > 0) {
    b2bChannel = existingChannels[0]
    console.log("B2B sales channel already exists:", b2bChannel.id)
  } else {
    // Create B2B sales channel
    b2bChannel = await salesChannelService.createSalesChannels({
      name: "B2B Wholesale",
      description: "Wholesale channel for business customers",
      is_disabled: false,
    })
    console.log("Created B2B sales channel:", b2bChannel.id)
  }

  // Check if publishable key already exists for this channel
  const existingKeys = await apiKeyService.listApiKeys({
    title: "B2B Storefront Key"
  })

  if (existingKeys.length > 0) {
    console.log("B2B publishable key already exists:")
    console.log("  Key:", existingKeys[0].token)
    console.log("  ID:", existingKeys[0].id)
    return
  }

  // Create publishable API key for B2B channel
  const publishableKey = await apiKeyService.createApiKeys({
    title: "B2B Storefront Key",
    type: "publishable",
    created_by: "admin",
  })

  console.log("Created B2B publishable API key:")
  console.log("  Key:", publishableKey.token)
  console.log("  ID:", publishableKey.id)

  // Link the key to the B2B sales channel
  await linkService.create({
    [Modules.API_KEY]: { publishable_key_id: publishableKey.id },
    [Modules.SALES_CHANNEL]: { sales_channel_id: b2bChannel.id },
  })
  console.log("Linked publishable key to B2B sales channel")

  console.log("\n=== UPDATE YOUR B2B .env.local ===")
  console.log(`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${publishableKey.token}`)
}
