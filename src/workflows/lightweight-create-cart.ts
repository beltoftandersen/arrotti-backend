/**
 * Lightweight Create Cart Workflow
 *
 * Replaces the default createCartWorkflow for empty carts (no items).
 * Skips: tax lines, promotions, payment collection refresh, inventory confirmation.
 * These are all no-ops on an empty cart but collectively add 2-3 seconds of overhead
 * from lock acquisitions, cart re-fetches, and sub-workflow orchestration.
 *
 * For carts WITH items, falls through to the full workflow.
 */
import {
  createWorkflow,
  WorkflowResponse,
  parallelize,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { CartWorkflowEvents, MedusaError } from "@medusajs/framework/utils"
import {
  findSalesChannelStep,
  findOneOrAnyRegionStep,
  findOrCreateCustomerStep,
  createCartsStep,
  emitEventStep,
} from "@medusajs/medusa/core-flows"

type LightweightCreateCartInput = {
  region_id?: string
  sales_channel_id?: string | null
  customer_id?: string | null
  email?: string | null
  currency_code?: string | null
  shipping_address?: Record<string, unknown>
  billing_address?: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  locale?: string | null
}

export const lightweightCreateCartWorkflow = createWorkflow(
  "lightweight-create-cart",
  function (input: LightweightCreateCartInput) {
    // Step 1: Resolve sales channel, region, and customer in parallel
    const [salesChannel, region, customerData] = parallelize(
      findSalesChannelStep({ salesChannelId: input.sales_channel_id }),
      findOneOrAnyRegionStep({ regionId: input.region_id }),
      findOrCreateCustomerStep({
        customerId: input.customer_id,
        email: input.email,
      })
    )

    // Step 2+3: Validate sales channel + prepare cart data
    const cartInput = transform(
      { input, region, customerData, salesChannel },
      (data) => {
        if (!data.salesChannel?.id) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Sales channel is required when creating a cart."
          )
        }
        if (!data.region) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            "No regions found"
          )
        }

        const cart: Record<string, unknown> = {
          ...data.input,
          currency_code:
            data.input.currency_code ?? data.region.currency_code,
          region_id: data.region.id,
          sales_channel_id: data.salesChannel!.id,
        }

        if (data.customerData.customer?.id) {
          cart.customer_id = data.customerData.customer.id
          cart.email =
            data.input.email ?? data.customerData.customer.email
        }

        // If there is only one country in the region, pre-fill shipping address
        if (
          !data.input.shipping_address &&
          data.region.countries?.length === 1
        ) {
          cart.shipping_address = {
            country_code: data.region.countries[0].iso_2,
          }
        }

        return cart
      }
    )

    // Step 4: Create the cart record (the only DB write)
    const carts = createCartsStep([cartInput as any])
    const cart = transform({ carts }, (data) => data.carts?.[0])

    // Step 5: Emit event (for subscribers like analytics)
    emitEventStep({
      eventName: CartWorkflowEvents.CREATED,
      data: { id: cart.id },
    })

    return new WorkflowResponse(cart)
  }
)
