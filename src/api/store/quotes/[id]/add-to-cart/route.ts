import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { QUOTE_MODULE } from "../../../../../modules/quote"
import QuoteModuleService from "../../../../../modules/quote/service"
import { FITMENT_MODULE } from "../../../../../modules/fitment"

/**
 * POST /store/quotes/:id/add-to-cart
 *
 * Add an accepted quote's item to the customer's cart at the quoted price.
 * Bypasses Medusa's pricing workflow by setting unit_price directly.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ message: "Authentication required" })
    return
  }

  const { id } = req.params
  const body = req.body as Record<string, unknown> | undefined
  const cart_id = typeof body?.cart_id === "string" ? body.cart_id : null

  if (!cart_id) {
    res.status(400).json({ message: "cart_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const quoteService: QuoteModuleService = req.scope.resolve(QUOTE_MODULE)
  const cartModule = req.scope.resolve(Modules.CART) as any
  const logger = req.scope.resolve("logger") as any

  // Load quote
  const [quote] = await quoteService.listQuotes(
    { id },
    {
      select: [
        "id",
        "customer_id",
        "product_id",
        "variant_id",
        "quantity",
        "quoted_price",
        "currency_code",
        "status",
      ],
    }
  )

  if (!quote || quote.customer_id !== customerId) {
    res.status(404).json({ message: "Quote not found" })
    return
  }

  if (quote.status !== "accepted") {
    res.status(400).json({
      message: "Quote must be accepted before adding to cart",
    })
    return
  }

  if (!quote.variant_id || quote.quoted_price == null) {
    res.status(400).json({ message: "Quote is missing variant or price" })
    return
  }

  // Verify cart exists and belongs to this customer
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id", "items.id", "items.metadata"],
    filters: { id: cart_id },
  })

  if (!carts?.length) {
    res.status(400).json({ message: "Cart not found" })
    return
  }

  const cart = carts[0] as any
  if (cart.customer_id && cart.customer_id !== customerId) {
    res.status(403).json({ message: "Cart does not belong to this customer" })
    return
  }

  // Check for duplicate — prevent adding the same quote twice
  const cartItems = cart.items || []
  const alreadyAdded = cartItems.some(
    (item: any) => item.metadata?.quote_id === id
  )
  if (alreadyAdded) {
    res.status(409).json({ message: "This quote has already been added to your cart" })
    return
  }

  // Load variant and product details for the line item
  let productTitle = "Quote Item"
  let variantTitle: string | undefined
  let variantSku: string | undefined
  let thumbnail: string | undefined
  let productId: string | undefined = quote.product_id
  let fitmentsJson: string | undefined

  try {
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "title",
        "sku",
        "product.id",
        "product.title",
        "product.thumbnail",
      ],
      filters: { id: quote.variant_id },
    })

    const variant = variants?.[0]
    if (variant) {
      variantTitle = variant.title || undefined
      variantSku = variant.sku || undefined
      if ((variant as any).product) {
        productTitle = (variant as any).product.title || productTitle
        thumbnail = (variant as any).product.thumbnail || undefined
        productId = (variant as any).product.id || productId
      }
    }
  } catch (err: any) {
    logger.warn(
      `[Quote Add-to-Cart] Could not load variant details: ${err.message}`
    )
  }

  // Fetch fitment data for the product (batch pattern: 3 queries total)
  try {
    const fitmentService = req.scope.resolve(FITMENT_MODULE) as any
    const { data: productFitments } = await query.graph({
      entity: "product",
      fields: ["fitments.*"],
      filters: { id: productId },
    })

    const fitments = productFitments?.[0]?.fitments || []
    if (fitments.length > 0) {
      const vehicleIds = [...new Set(fitments.map((f: any) => f.vehicle_id))]

      // Batch-load all vehicles, then all makes + models in parallel
      const vehicles = await fitmentService.listVehicles({ id: vehicleIds })
      const makeIds = [...new Set(vehicles.map((v: any) => v.make_id).filter(Boolean))]
      const modelIds = [...new Set(vehicles.map((v: any) => v.model_id).filter(Boolean))]

      const [makes, models] = await Promise.all([
        makeIds.length ? fitmentService.listVehicleMakes({ id: makeIds }) : [],
        modelIds.length ? fitmentService.listVehicleModels({ id: modelIds }) : [],
      ])

      const makeMap = new Map(makes.map((m: any) => [m.id, m.name]))
      const modelMap = new Map(models.map((m: any) => [m.id, m.name]))

      const vehicleMap = new Map<string, any>()
      for (const v of vehicles) {
        vehicleMap.set(v.id, {
          year_start: v.year_start,
          year_end: v.year_end,
          make_name: makeMap.get(v.make_id) || "",
          model_name: modelMap.get(v.model_id) || "",
        })
      }

      const structuredFitments = fitments.map((f: any) => {
        const v = vehicleMap.get(f.vehicle_id)
        const yearStr = v
          ? v.year_start === v.year_end
            ? String(v.year_start)
            : `${v.year_start}-${v.year_end}`
          : ""
        return {
          vehicle_id: f.vehicle_id,
          vehicle: v ? `${yearStr} ${v.make_name} ${v.model_name}` : "",
          years: yearStr,
          make: v?.make_name || "",
          model: v?.model_name || "",
          submodels: f.submodels || [],
          conditions: f.conditions ? f.conditions.split(";").map((c: string) => c.trim()).filter(Boolean) : [],
        }
      })

      fitmentsJson = JSON.stringify(structuredFitments)
    }
  } catch (err: any) {
    logger.warn(
      `[Quote Add-to-Cart] Could not load fitment data: ${err.message}`
    )
  }

  // quoted_price is in cents, Medusa unit_price is in the currency's base unit
  // For USD: quoted_price 5000 cents = $50.00, unit_price should be 50
  const unitPrice = Number(quote.quoted_price) / 100

  try {
    await cartModule.addLineItems(cart_id, [
      {
        title: productTitle,
        subtitle: variantTitle,
        variant_id: quote.variant_id,
        product_id: productId,
        product_title: productTitle,
        variant_title: variantTitle,
        variant_sku: variantSku,
        thumbnail: thumbnail,
        quantity: quote.quantity,
        unit_price: unitPrice,
        is_custom_price: true,
        metadata: {
          quote_id: quote.id,
          ...(fitmentsJson ? { fitments_json: fitmentsJson } : {}),
        },
      },
    ])

    logger.info(
      `[Quote Add-to-Cart] Added quote ${id} to cart ${cart_id} ` +
        `(variant: ${quote.variant_id}, qty: ${quote.quantity}, price: $${unitPrice})`
    )

    res.json({ success: true })
  } catch (err: any) {
    logger.error(
      `[Quote Add-to-Cart] Failed to add line item: ${err.message}`
    )
    res.status(500).json({
      message: "Failed to add item to cart",
    })
  }
}
