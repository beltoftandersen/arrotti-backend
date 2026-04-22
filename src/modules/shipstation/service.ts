import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CartAddressDTO,
  CartLineItemDTO,
  CreateShippingOptionDTO,
  FulfillmentOption,
  OrderLineItemDTO,
  StockLocationAddressDTO,
} from "@medusajs/framework/types"
import { ShipStationClient } from "./client"
import {
  GetShippingRatesResponse,
  Rate,
  ShipStationAddress,
} from "./types"
import { packCart, PackInput } from "../../lib/package-packer"

type WeightUnit = "pound" | "ounce" | "gram" | "kilogram"
type DimensionUnit = "inch" | "centimeter"

export type ShipStationOptions = {
  api_key: string
  base_url?: string
}

// In-memory cache for shipment IDs created during calculatePrice.
// Avoids redundant ShipStation API calls when validateFulfillmentData runs
// for the same carrier+address shortly after.
const SHIPMENT_CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const SHIPMENT_CACHE_MAX = 500
const shipmentCache = new Map<string, { shipment_id: string; timestamp: number }>()

function pruneShipmentCache() {
  const now = Date.now()
  for (const [key, val] of shipmentCache) {
    if (now - val.timestamp > SHIPMENT_CACHE_TTL) {
      shipmentCache.delete(key)
    }
  }
  // Hard cap: if still over max, remove oldest entries
  if (shipmentCache.size > SHIPMENT_CACHE_MAX) {
    const entries = [...shipmentCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toRemove = entries.slice(0, entries.length - SHIPMENT_CACHE_MAX)
    for (const [key] of toRemove) {
      shipmentCache.delete(key)
    }
  }
}

function buildShipmentCacheKey(
  carrierId: string,
  serviceCode: string,
  postalCode: string,
  countryCode: string
): string {
  return `${carrierId}:${serviceCode}:${postalCode}:${countryCode}`
}

// In-memory cache for calculated rate results.
// Avoids redundant ShipStation API calls when calculatePrice is called
// multiple times for the same carrier+address+items (e.g. once to display
// prices, again when the shipping method is added to the cart).
const RATE_RESULT_CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const RATE_RESULT_CACHE_MAX = 500
const rateResultCache = new Map<
  string,
  { calculated_amount: number; is_tax_inclusive: boolean; timestamp: number }
>()

function pruneRateResultCache() {
  const now = Date.now()
  for (const [key, val] of rateResultCache) {
    if (now - val.timestamp > RATE_RESULT_CACHE_TTL) {
      rateResultCache.delete(key)
    }
  }
  if (rateResultCache.size > RATE_RESULT_CACHE_MAX) {
    const entries = [...rateResultCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )
    const toRemove = entries.slice(0, entries.length - RATE_RESULT_CACHE_MAX)
    for (const [key] of toRemove) {
      rateResultCache.delete(key)
    }
  }
}

function buildRateResultCacheKey(
  carrierId: string,
  serviceCode: string,
  postalCode: string,
  countryCode: string,
  items: Array<{ variant_id?: string | null; quantity: number }>,
  currencyCode: string
): string {
  const itemsKey = items
    .map((i) => `${i.variant_id ?? "?"}:${i.quantity}`)
    .sort()
    .join(",")
  return `rate:${carrierId}:${serviceCode}:${postalCode}:${countryCode}:${itemsKey}:${currencyCode}`
}

class ShipStationProviderService extends AbstractFulfillmentProviderService {
  static identifier = "shipstation"
  protected options_: ShipStationOptions
  protected client: ShipStationClient

  constructor({}, options: ShipStationOptions) {
    super()

    this.options_ = options
    this.client = new ShipStationClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    const { carriers } = await this.client.getCarriers()
    const fulfillmentOptions: FulfillmentOption[] = []

    carriers
      .filter((carrier) => !carrier.disabled_by_billing_plan)
      .forEach((carrier) => {
        carrier.services.forEach((service) => {
          fulfillmentOptions.push({
            id: `${carrier.carrier_id}__${service.service_code}`,
            name: service.name,
            carrier_id: carrier.carrier_id,
            carrier_service_code: service.service_code,
          })
        })
      })

    return fulfillmentOptions
  }

  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  private async createShipment({
    carrier_id,
    carrier_service_code,
    from_address,
    to_address,
    items,
    currency_code,
  }: {
    carrier_id: string
    carrier_service_code: string
    from_address?: {
      name?: string
      address?: Omit<
        StockLocationAddressDTO,
        "created_at" | "updated_at" | "deleted_at"
      >
    }
    to_address?: Omit<
      CartAddressDTO,
      "created_at" | "updated_at" | "deleted_at" | "id"
    >
    items: CartLineItemDTO[] | OrderLineItemDTO[]
    currency_code: string
  }): Promise<GetShippingRatesResponse> {
    if (!from_address?.address) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "from_location.address is required to calculate shipping rate"
      )
    }
    const ship_from: ShipStationAddress = {
      name: from_address?.name || "",
      phone: from_address?.address?.phone || "",
      address_line1: from_address?.address?.address_1 || "",
      address_line2: from_address?.address?.address_2 || null,
      city_locality: from_address?.address?.city || "",
      state_province: from_address?.address?.province || "",
      postal_code: from_address?.address?.postal_code || "",
      country_code: from_address?.address?.country_code || "",
      address_residential_indicator: "unknown",
    }
    if (!to_address) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "shipping_address is required to calculate shipping rate"
      )
    }

    const ship_to: ShipStationAddress = {
      name: `${to_address.first_name} ${to_address.last_name}`,
      phone: to_address.phone || "",
      address_line1: to_address.address_1 || "",
      address_line2: to_address.address_2 || null,
      city_locality: to_address.city || "",
      state_province: to_address.province || "",
      postal_code: to_address.postal_code || "",
      country_code: to_address.country_code || "",
      address_residential_indicator: "unknown",
    }

    const packInputs: PackInput[] = (items || []).map((item: any) => ({
      variant_id: item.variant_id ?? null,
      quantity: Number(item.quantity) || 0,
      weight: item.variant?.weight ?? null,
      length: item.variant?.length ?? null,
      width: item.variant?.width ?? null,
      height: item.variant?.height ?? null,
    }))
    const packed = packCart(packInputs)
    if (packed.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot calculate shipping: cart has no items or items lack weights."
      )
    }

    const weightUnit = (process.env.SHIPPING_WEIGHT_UNIT || "pound") as WeightUnit
    const dimensionUnit = (process.env.SHIPPING_DIMENSION_UNIT || "inch") as DimensionUnit

    const packagePayloads = packed.map((p) => {
      const payload: any = {
        package_code: "package",
        weight: { value: p.weight, unit: weightUnit },
      }
      if (p.length > 0 && p.width > 0 && p.height > 0) {
        payload.dimensions = {
          length: p.length,
          width: p.width,
          height: p.height,
          unit: dimensionUnit,
        }
      }
      return payload
    })

    return await this.client.getShippingRates({
      shipment: {
        carrier_id: carrier_id,
        service_code: carrier_service_code,
        ship_to,
        ship_from,
        validate_address: "validate_and_clean",
        items: items?.map((item) => ({
          name: item.title,
          quantity: item.quantity,
          sku: item.variant_sku || "",
        })),
        packages: packagePayloads,
        customs: {
          contents: "merchandise",
          non_delivery: "return_to_sender",
        },
      },
      rate_options: {
        carrier_ids: [carrier_id],
        service_codes: [carrier_service_code],
        preferred_currency: currency_code as string,
      },
    })
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const { shipment_id } =
      (data as {
        shipment_id?: string
      }) || {}
    const { carrier_id, carrier_service_code } = optionData as {
      carrier_id: string
      carrier_service_code: string
    }

    const addr = context.shipping_address as any
    const postalCode: string = addr?.postal_code || ""
    const countryCode: string = addr?.country_code || ""
    const currencyCode = context.currency_code as string

    // --- 1. Check rate result cache (instant return) ---
    if (!shipment_id) {
      const rateCacheKey = buildRateResultCacheKey(
        carrier_id,
        carrier_service_code,
        postalCode,
        countryCode,
        (context.items || []) as Array<{
          variant_id?: string | null
          quantity: number
        }>,
        currencyCode
      )
      const cachedRate = rateResultCache.get(rateCacheKey)
      if (cachedRate && Date.now() - cachedRate.timestamp < RATE_RESULT_CACHE_TTL) {
        return {
          calculated_amount: cachedRate.calculated_amount,
          is_calculated_price_tax_inclusive: cachedRate.is_tax_inclusive,
        }
      }
    }

    // --- 2. Fetch rate from ShipStation ---
    // Always create a fresh shipment when items may have changed. The
    // shipment cache key is carrier+service+address only (no items), so
    // reusing a cached shipment_id here would return rates for the old
    // packages when the cart has mutated. validateFulfillmentData still
    // consumes shipmentCache safely because the rate cached above is
    // recomputed per item set.
    let rate: Rate | undefined

    if (!shipment_id) {
      const shipment = await this.createShipment({
        carrier_id,
        carrier_service_code,
        from_address: {
          name: context.from_location?.name,
          address: context.from_location?.address,
        },
        to_address: context.shipping_address,
        items: context.items || [],
        currency_code: currencyCode,
      })
      rate = shipment.rate_response?.rates?.[0]

      if (shipment.shipment_id) {
        pruneShipmentCache()
        shipmentCache.set(
          buildShipmentCacheKey(carrier_id, carrier_service_code, postalCode, countryCode),
          { shipment_id: shipment.shipment_id, timestamp: Date.now() }
        )
      }
    } else {
      const rateResponse = await this.client.getShipmentRates(shipment_id)
      rate = rateResponse?.[0]?.rates?.[0]
    }

    if (!rate) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "ShipStation returned no shipping rates. Cannot calculate shipping price."
      )
    }

    // --- 3. Compute final price and cache it ---
    const calculatedPrice =
      rate.shipping_amount.amount +
      rate.insurance_amount.amount +
      rate.confirmation_amount.amount +
      rate.other_amount.amount +
      (rate.tax_amount?.amount || 0)

    if (!shipment_id) {
      const rateCacheKey = buildRateResultCacheKey(
        carrier_id,
        carrier_service_code,
        postalCode,
        countryCode,
        (context.items || []) as Array<{
          variant_id?: string | null
          quantity: number
        }>,
        currencyCode
      )
      pruneRateResultCache()
      rateResultCache.set(rateCacheKey, {
        calculated_amount: calculatedPrice,
        is_tax_inclusive: !!rate.tax_amount,
        timestamp: Date.now(),
      })
    }

    return {
      calculated_amount: calculatedPrice,
      is_calculated_price_tax_inclusive: !!rate.tax_amount,
    }
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<any> {
    let { shipment_id } = data as {
      shipment_id?: string
    }

    if (!shipment_id) {
      const { carrier_id, carrier_service_code } = optionData as {
        carrier_id: string
        carrier_service_code: string
      }
      const ctx = context as any

      // Check cache from calculatePrice — avoids redundant ShipStation call
      const addr = ctx.shipping_address || {}
      const cacheKey = buildShipmentCacheKey(
        carrier_id, carrier_service_code,
        addr.postal_code || "", addr.country_code || ""
      )
      const cached = shipmentCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < SHIPMENT_CACHE_TTL) {
        shipment_id = cached.shipment_id
      } else {
        if (cached) shipmentCache.delete(cacheKey)
        const shipment = await this.createShipment({
          carrier_id,
          carrier_service_code,
          from_address: {
            name: ctx.from_location?.name,
            address: ctx.from_location?.address,
          },
          to_address: ctx.shipping_address,
          items: ctx.items || [],
          currency_code: ctx.currency_code,
        })
        shipment_id = shipment.shipment_id

        // Cache for future use
        if (shipment_id) {
          pruneShipmentCache()
          shipmentCache.set(cacheKey, {
            shipment_id,
            timestamp: Date.now(),
          })
        }
      }
    }

    return {
      ...data,
      shipment_id,
    }
  }

  async createFulfillment(
    data: object,
    items: object[],
    order: object | undefined,
    fulfillment: Record<string, unknown>
  ): Promise<any> {
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Order is required to create a ShipStation fulfillment"
      )
    }

    const { shipment_id } = data as {
      shipment_id: string
    }

    const originalShipment = await this.client.getShipment(shipment_id)

    const orderItems = (order as any).items || []
    const orderItemsToFulfill: any[] = []

    for (const item of items) {
      const lineItemId = (item as any).line_item_id
      const orderItem = orderItems.find((i: any) => i.id === lineItemId)

      if (!orderItem) {
        continue
      }

      orderItemsToFulfill.push({
        ...orderItem,
        quantity: (item as any).quantity,
      })
    }

    const newShipment = await this.createShipment({
      carrier_id: originalShipment.carrier_id,
      carrier_service_code: originalShipment.service_code,
      from_address: {
        name: originalShipment.ship_from.name,
        address: {
          ...originalShipment.ship_from,
          address_1: originalShipment.ship_from.address_line1,
          city: originalShipment.ship_from.city_locality,
          province: originalShipment.ship_from.state_province,
        },
      },
      to_address: (order as any).shipping_address,
      items: orderItemsToFulfill as OrderLineItemDTO[],
      currency_code: (order as any).currency_code,
    })

    const label = await this.client.purchaseLabelForShipment(
      newShipment.shipment_id
    )

    const combinedLabelUrl = label.label_download?.pdf || label.label_download?.href || ""
    const packageTrackingNumbers = (label.packages ?? [])
      .map((p) => p.tracking_number)
      .filter((t): t is string => !!t)

    const labels =
      packageTrackingNumbers.length > 1
        ? label.packages!
            .map((p, idx) => {
              const tn = p.tracking_number
              if (!tn) return null
              return {
                tracking_number: tn,
                tracking_url: `https://track.shipstation.com/${tn}`,
                label_url:
                  p.label_download?.pdf ||
                  p.label_download?.href ||
                  (idx === 0 ? combinedLabelUrl : ""),
              }
            })
            .filter((l): l is NonNullable<typeof l> => l !== null)
        : [
            {
              tracking_number: label.tracking_number,
              tracking_url: label.tracking_number
                ? `https://track.shipstation.com/${label.tracking_number}`
                : "",
              label_url: combinedLabelUrl,
            },
          ]

    return {
      data: {
        ...((fulfillment.data as object) || {}),
        label_id: label.label_id,
        shipment_id: label.shipment_id,
        package_count: packageTrackingNumbers.length || 1,
        tracking_numbers: packageTrackingNumbers.length > 0
          ? packageTrackingNumbers
          : [label.tracking_number],
      },
      labels,
    }
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    // Validate that required carrier fields are present
    const { carrier_id, carrier_service_code } = data as {
      carrier_id?: string
      carrier_service_code?: string
    }
    return !!(carrier_id && carrier_service_code)
  }

  async createReturnFulfillment(
    fulfillment: Record<string, unknown>
  ): Promise<any> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Return fulfillment is not supported by the ShipStation provider. Process returns manually in ShipStation."
    )
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<any> {
    const { label_id, shipment_id } = data as {
      label_id: string
      shipment_id: string
    }

    await this.client.voidLabel(label_id)
    await this.client.cancelShipment(shipment_id)
  }
}

export default ShipStationProviderService
