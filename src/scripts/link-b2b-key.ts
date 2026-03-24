import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"

export default async function linkB2BKey({ container }: ExecArgs) {
  const apiKeyId = "apk_01KG816VYZZS830TY2S4JEXSMH"
  const salesChannelId = "sc_01KG816VXBCEYZT0PVG609XCN4"

  // Use the workflow to link
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: apiKeyId,
      add: [salesChannelId],
    },
  })

  console.log("Successfully linked B2B publishable key to B2B sales channel!")
  console.log("\n=== UPDATE YOUR B2B .env.local ===")
  console.log("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_84b691bdca29747e2263a57156717c4296bffe4c25f20d3b3b90be3c3d104420")
}
