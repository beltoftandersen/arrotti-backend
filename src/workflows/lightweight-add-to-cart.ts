/**
 * Lightweight Add-to-Cart Workflow
 *
 * Replaces the default addToCartWorkflow with a conditional refresh strategy:
 *
 * FAST PATH (no refresh): When the cart has no shipping methods, no promotions,
 * no shipping address, and the region is not tax-inclusive — just add the line
 * item and skip the expensive refreshCartItemsWorkflow.
 *
 * FULL REFRESH: When ANY of these are true, run the standard refresh:
 * - Cart has shipping methods (active checkout)
 * - Cart has a shipping address (checkout started)
 * - Cart has active promotions (discounts would go stale)
 * - Region uses automatic_taxes (tax-inclusive pricing needs immediate recalc)
 *
 * This is safe because:
 * - Tax is recalculated when address is entered at checkout
 * - Promotions are recalculated when promo codes are applied
 * - Payment collection is created at checkout payment step
 * - Shipping methods are selected after items are added
 *
 * The cart sidebar shows subtotal-only until checkout, which is standard for
 * US ecommerce ("+ tax at checkout").
 */
import {
  createWorkflow,
  WorkflowResponse,
  parallelize,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  CartWorkflowEvents,
  deduplicate,
  isDefined,
} from "@medusajs/framework/utils"
import {
  acquireLockStep,
  releaseLockStep,
  emitEventStep,
  useQueryGraphStep,
  getTranslatedLineItemsStep,
  validateLineItemPricesStep,
  getLineItemActionsStep,
  createLineItemsStep,
  updateLineItemsStep,
  getVariantPriceSetsStep,
  confirmVariantInventoryWorkflow,
  refreshCartItemsWorkflow,
} from "@medusajs/medusa/core-flows"
import { filterObjectByKeys, simpleHash } from "@medusajs/framework/utils"

// These field lists match what the default addToCartWorkflow uses
// Matches the original cartFieldsForPricingContext from core-flows
const cartFieldsForPricingContext = [
  "id",
  "sales_channel_id",
  "currency_code",
  "region_id",
  "shipping_address.city",
  "shipping_address.country_code",
  "shipping_address.province",
  "shipping_address.postal_code",
  "item_total",
  "total",
  "locale",
  "customer.id",
  "email",
  "customer.groups.id",
  // Additional fields for conditional refresh check
  "shipping_methods.id",
  "promotions.id",
  "region.automatic_taxes",
]

const productVariantsFields = [
  "id",
  "title",
  "sku",
  "barcode",
  "product.id",
  "product.title",
  "product.description",
  "product.subtitle",
  "product.thumbnail",
  "product.type",
  "product.type_id",
  "product.collection",
  "product.collection_id",
  "product.handle",
  "calculated_price.*",
  "inventory_quantity",
  "manage_inventory",
  "allow_backorder",
  "weight",
  "length",
  "height",
  "width",
  "material",
]

// Fields needed by confirmVariantInventoryWorkflow
// Must match @medusajs/core-flows prepare-confirm-inventory-input.ts
// deepFlatMap walks: variants.inventory_items.inventory.location_levels.stock_locations.sales_channels
// Missing any link in this chain causes "Sales channel X is not associated with any stock location"
const requiredVariantFieldsForInventoryConfirmation = [
  "id",
  "manage_inventory",
  "allow_backorder",
  "inventory_quantity",
  "inventory_items.inventory_item_id",
  "inventory_items.required_quantity",
  "inventory_items.inventory.location_levels.stocked_quantity",
  "inventory_items.inventory.location_levels.reserved_quantity",
  "inventory_items.inventory.location_levels.raw_stocked_quantity",
  "inventory_items.inventory.location_levels.raw_reserved_quantity",
  "inventory_items.inventory.location_levels.location_id",
  "inventory_items.inventory.location_levels.stock_locations.id",
  "inventory_items.inventory.location_levels.stock_locations.name",
  "inventory_items.inventory.location_levels.stock_locations.sales_channels.id",
  "inventory_items.inventory.location_levels.stock_locations.sales_channels.name",
]

type LightweightAddToCartInput = {
  cart_id: string
  items: Array<{
    variant_id: string
    quantity: number
    unit_price?: number
    is_tax_inclusive?: boolean
    metadata?: Record<string, unknown>
  }>
  additional_data?: Record<string, unknown>
}

export const lightweightAddToCartWorkflow = createWorkflow(
  {
    name: "lightweight-add-to-cart",
    idempotent: false,
  },
  function (input: LightweightAddToCartInput) {
    // Step 1: Acquire lock on the cart
    acquireLockStep({
      key: input.cart_id,
      timeout: 2,
      ttl: 10,
    })

    // Step 2: Fetch cart with fields needed for pricing + conditional refresh check
    const cartFields = [
      "completed_at",
      "locale",
      ...cartFieldsForPricingContext,
    ]

    const { data: cart } = useQueryGraphStep({
      entity: "cart",
      filters: { id: input.cart_id },
      fields: cartFields,
      options: { throwIfKeyNotFound: true, isList: false },
    }).config({ name: "get-cart" }) as any

    // Step 3: Extract variant IDs
    const variantIds = transform({ input }, (data) => {
      return (data.input.items ?? [])
        .map((i) => i.variant_id)
        .filter((v) => !!v)
    })

    // Step 4: Fetch variants (without prices — prices come from getVariantPriceSetsStep)
    const variantFields = deduplicate([
      ...productVariantsFields.filter((f) => !f.startsWith("calculated_price")),
      ...requiredVariantFieldsForInventoryConfirmation,
    ])

    const { data: variantsData } = useQueryGraphStep({
      entity: "variants",
      fields: variantFields,
      filters: { id: variantIds },
      options: { cache: { enable: true } },
    }).config({ name: "fetch-variants" }) as any

    // Step 5: Build pricing context and get calculated prices
    const cartPricingContext = transform(
      { cart, items: input.items },
      (data: any) => {
        const c = data.cart
        const baseContext = {
          ...filterObjectByKeys(c, cartFieldsForPricingContext as any),
          customer: c.customer,
          region: c.region,
          currency_code: c.currency_code ?? c.region?.currency_code,
          region_id: c.region_id,
          customer_id: c.customer_id,
        }
        return (data.items ?? [])
          .filter((i: any) => i.variant_id)
          .map((item: any) => {
            const idLike = item.id ?? simpleHash(JSON.stringify(item))
            return {
              id: idLike,
              variantId: item.variant_id,
              context: { ...baseContext, quantity: item.quantity },
            }
          })
      }
    )

    const calculatedPriceSets = getVariantPriceSetsStep({
      data: cartPricingContext,
    } as any)

    // Step 6: Merge variants with calculated prices
    const variants = transform(
      { variantsData, calculatedPriceSets, items: input.items },
      ({ variantsData, calculatedPriceSets, items }: any) => {
        for (const item of items ?? []) {
          const idLike = item.id ?? simpleHash(JSON.stringify(item))
          const priceSet =
            calculatedPriceSets[idLike] ??
            calculatedPriceSets[item.variant_id]
          if (priceSet) {
            const variant = variantsData.find(
              (v: any) => v.id === item.variant_id
            )
            if (variant) {
              variant.calculated_price = priceSet
            }
          }
        }
        return variantsData
      }
    )

    // Step 7: Prepare line items
    const lineItems = transform(
      {
        cart_id: input.cart_id,
        items: input.items,
        variants,
      },
      ({ cart_id, items: items_, variants }) => {
        const items = (items_ ?? []).map((item: any) => {
          const variant = (variants ?? []).find(
            (v: any) => v.id === item.variant_id
          )
          const unitPrice =
            item.unit_price ?? variant?.calculated_price?.calculated_amount
          const isTaxInclusive =
            item.is_tax_inclusive ??
            variant?.calculated_price
              ?.is_calculated_price_tax_inclusive
          return {
            variant_id: item.variant_id,
            quantity: item.quantity,
            unit_price: unitPrice,
            is_tax_inclusive: isTaxInclusive,
            cart_id,
            title: variant?.product?.title ?? variant?.title ?? "",
            thumbnail: variant?.product?.thumbnail,
            product_id: variant?.product?.id,
            product_title: variant?.product?.title,
            product_description: variant?.product?.description,
            product_subtitle: variant?.product?.subtitle,
            product_type: variant?.product?.type,
            product_type_id: variant?.product?.type_id,
            product_collection: variant?.product?.collection,
            product_handle: variant?.product?.handle,
            variant_sku: variant?.sku,
            variant_barcode: variant?.barcode,
            variant_title: variant?.title,
            requires_shipping: true,
            is_custom_price: isDefined(item.unit_price),
            compare_at_unit_price:
              variant?.calculated_price?.original_amount,
            metadata: item.metadata,
          }
        })
        return items
      }
    )

    // Step 8: Validate all line items have prices
    validateLineItemPricesStep({ items: lineItems } as any)

    // Step 9: Determine create vs update actions
    const { itemsToCreate = [], itemsToUpdate = [] } =
      getLineItemActionsStep({
        id: cart.id,
        items: lineItems,
      } as any)

    // Step 10: Confirm inventory
    const itemsToConfirmInventory = transform(
      { itemsToUpdate, itemsToCreate },
      (data: any) => {
        return [
          ...(data.itemsToUpdate ?? []),
          ...(data.itemsToCreate ?? []),
        ].filter((item: any) =>
          isDefined(
            "data" in item ? item.data?.variant_id : item.variant_id
          )
        )
      }
    )

    confirmVariantInventoryWorkflow.runAsStep({
      input: {
        sales_channel_id: cart.sales_channel_id,
        variants,
        items: input.items,
        itemsToUpdate: itemsToConfirmInventory,
      } as any,
    })

    // Step 11: Translate line items
    const itemsToCreateVariants = transform(
      { itemsToCreate, variants },
      (data: any) => {
        if (!data.itemsToCreate?.length) return []
        const variantsMap = new Map(
          data.variants?.map((v: any) => [v.id, v])
        )
        return data.itemsToCreate
          .map(
            (item: any) =>
              item.variant_id && variantsMap.get(item.variant_id)
          )
          .filter(Boolean)
      }
    )

    const translatedItemsToCreate = getTranslatedLineItemsStep({
      items: itemsToCreate,
      variants: itemsToCreateVariants,
      locale: cart.locale,
    } as any)

    // Step 12: Create and update line items in parallel
    const [createdLineItems, updatedLineItems] = parallelize(
      createLineItemsStep({
        id: cart.id,
        items: translatedItemsToCreate,
      } as any),
      updateLineItemsStep({
        id: cart.id,
        items: itemsToUpdate,
      } as any)
    )

    const allItems = transform(
      { createdLineItems, updatedLineItems },
      ({ createdLineItems = [], updatedLineItems = [] }: any) => {
        return createdLineItems.concat(updatedLineItems)
      }
    )

    // Step 13: CONDITIONAL REFRESH
    // Only skip the expensive refreshCartItemsWorkflow when the cart is in
    // a "shopping" state. Fall back to full refresh if ANY of these are true:
    // - Cart has shipping methods (active checkout)
    // - Cart has a shipping address (checkout started)
    // - Cart has active promotions (discounts would go stale on item changes)
    // - Region uses automatic_taxes (tax-inclusive pricing requires immediate recalc)
    const needsRefresh = transform({ cart }, ({ cart }: any) => {
      const hasShippingMethods =
        Array.isArray(cart.shipping_methods) &&
        cart.shipping_methods.length > 0
      const hasShippingAddress = !!cart.shipping_address?.country_code
      const hasPromotions =
        Array.isArray(cart.promotions) && cart.promotions.length > 0
      const isTaxInclusive = !!cart.region?.automatic_taxes
      return (
        hasShippingMethods ||
        hasShippingAddress ||
        hasPromotions ||
        isTaxInclusive
      )
    })

    when("needs-full-refresh", { needsRefresh }, ({ needsRefresh }) =>
      needsRefresh
    ).then(() => {
      refreshCartItemsWorkflow.runAsStep({
        input: {
          cart_id: cart.id,
          items: allItems,
          additional_data: input.additional_data,
        },
      })
    })

    // Step 14: Emit event and release lock
    parallelize(
      emitEventStep({
        eventName: CartWorkflowEvents.UPDATED,
        data: { id: cart.id },
      }),
      releaseLockStep({
        key: cart.id,
      })
    )

    return new WorkflowResponse(void 0)
  }
)
