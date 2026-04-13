import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CreateShippingOptionDTO,
  FulfillmentOption,
  OrderLineItemDTO,
} from "@medusajs/framework/types"
import { UpsClient } from "./client"
import {
  UpsOptions,
  UpsAddress,
  UpsPackage,
  UPS_SERVICES,
  UPS_SERVICE_CODES,
} from "./types"
import { packCart, PackInput } from "../../lib/package-packer"

type WeightUnit = "pound" | "ounce" | "gram" | "kilogram"
type DimensionUnit = "inch" | "centimeter"

// Weight unit mapping: env value → UPS API value
const WEIGHT_UNIT_MAP: Record<string, "LBS" | "KGS"> = {
  pound: "LBS",
  ounce: "LBS", // convert oz to lbs
  gram: "KGS",  // convert g to kg
  kilogram: "KGS",
}

// Dimension unit mapping: env value → UPS API value
const DIMENSION_UNIT_MAP: Record<string, "IN" | "CM"> = {
  inch: "IN",
  centimeter: "CM",
}

// Weight conversion factors to the UPS unit
const WEIGHT_CONVERSION: Record<string, number> = {
  pound: 1,
  ounce: 1 / 16,
  gram: 1 / 1000,
  kilogram: 1,
}

// Rate result cache — avoids redundant UPS API calls when calculatePrice
// is called multiple times for the same service+address+items
const RATE_CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const RATE_CACHE_MAX = 500
const rateCache = new Map<
  string,
  { calculated_amount: number; timestamp: number }
>()

function pruneRateCache() {
  const now = Date.now()
  for (const [key, val] of rateCache) {
    if (now - val.timestamp > RATE_CACHE_TTL) {
      rateCache.delete(key)
    }
  }
  if (rateCache.size > RATE_CACHE_MAX) {
    const entries = [...rateCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )
    const toRemove = entries.slice(0, entries.length - RATE_CACHE_MAX)
    for (const [key] of toRemove) {
      rateCache.delete(key)
    }
  }
}

function buildRateCacheKey(
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
  return `rate:ups:${serviceCode}:${postalCode}:${countryCode}:${itemsKey}:${currencyCode}`
}

class UpsProviderService extends AbstractFulfillmentProviderService {
  static identifier = "ups"
  protected options_: UpsOptions
  protected client: UpsClient

  constructor({}, options: UpsOptions) {
    super()
    this.options_ = options
    this.client = new UpsClient(options)
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return Object.entries(UPS_SERVICES).map(([code, name]) => ({
      id: `ups__${code}`,
      name,
      ups_service_code: code,
    }))
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  /**
   * Build a UPS-formatted address from Medusa address data.
   */
  private buildUpsAddress(
    address: Partial<{
      address_1: string | null
      address_2: string | null
      city: string | null
      province: string | null
      postal_code: string | null
      country_code: string | null
    }>
  ): UpsAddress {
    const lines = [address.address_1 || ""]
    if (address.address_2) {
      lines.push(address.address_2)
    }
    return {
      AddressLine: lines,
      City: address.city || "",
      StateProvinceCode: address.province || "",
      PostalCode: address.postal_code || "",
      CountryCode: address.country_code || "",
    }
  }

  private packageToUpsPackage(pkg: {
    weight: number
    length: number
    width: number
    height: number
  }): UpsPackage {
    const envWeightUnit = (process.env.SHIPPING_WEIGHT_UNIT ||
      "pound") as WeightUnit
    const envDimensionUnit = (process.env.SHIPPING_DIMENSION_UNIT ||
      "inch") as DimensionUnit
    const upsWeightUnit = WEIGHT_UNIT_MAP[envWeightUnit] || "LBS"
    const upsDimensionUnit = DIMENSION_UNIT_MAP[envDimensionUnit] || "IN"
    const conversionFactor = WEIGHT_CONVERSION[envWeightUnit] || 1
    const convertedWeight = pkg.weight * conversionFactor

    const out: UpsPackage = {
      PackagingType: { Code: "02", Description: "Package" },
      PackageWeight: {
        UnitOfMeasurement: { Code: upsWeightUnit },
        Weight: convertedWeight.toFixed(1),
      },
    }
    if (pkg.length > 0 && pkg.width > 0 && pkg.height > 0) {
      out.Dimensions = {
        UnitOfMeasurement: { Code: upsDimensionUnit },
        Length: pkg.length.toFixed(1),
        Width: pkg.width.toFixed(1),
        Height: pkg.height.toFixed(1),
      }
    }
    return out
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const { ups_service_code } = optionData as {
      ups_service_code: string
    }

    const addr = context.shipping_address as any
    const postalCode: string = addr?.postal_code || ""
    const countryCode: string = addr?.country_code || ""
    const currencyCode = context.currency_code as string

    // Check rate cache
    const cacheKey = buildRateCacheKey(
      ups_service_code,
      postalCode,
      countryCode,
      (context.items || []) as Array<{
        variant_id?: string | null
        quantity: number
      }>,
      currencyCode
    )
    const cached = rateCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < RATE_CACHE_TTL) {
      return {
        calculated_amount: cached.calculated_amount,
        is_calculated_price_tax_inclusive: false,
      }
    }

    // Build addresses
    const fromLocation = context.from_location as any
    if (!fromLocation?.address) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "from_location.address is required to calculate UPS shipping rate"
      )
    }
    if (!context.shipping_address) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "shipping_address is required to calculate UPS shipping rate"
      )
    }

    const shipFromAddress = this.buildUpsAddress(fromLocation.address)
    const shipToAddress = this.buildUpsAddress(context.shipping_address as any)

    const packInputs: PackInput[] = ((context.items || []) as any[]).map(
      (item) => ({
        variant_id: item.variant_id ?? null,
        quantity: Number(item.quantity) || 0,
        weight: item.variant?.weight ?? null,
        length: item.variant?.length ?? null,
        width: item.variant?.width ?? null,
        height: item.variant?.height ?? null,
      })
    )
    const packed = packCart(packInputs)
    if (packed.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot calculate shipping: cart has no items or items lack weights."
      )
    }
    const upsPackages = packed.map((p) => this.packageToUpsPackage(p))

    const rateResponse = await this.client.getRates({
      RateRequest: {
        Request: {
          SubVersion: "2403",
        },
        Shipment: {
          Shipper: {
            Name: fromLocation.name || "",
            ShipperNumber: this.options_.account_number,
            Address: shipFromAddress,
          },
          ShipTo: {
            Name: "",
            Address: shipToAddress,
          },
          ShipFrom: {
            Name: fromLocation.name || "",
            Address: shipFromAddress,
          },
          Service: { Code: ups_service_code },
          Package: upsPackages,
        },
      },
    })

    const rated = rateResponse.RateResponse?.RatedShipment
    if (!rated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "UPS returned no shipping rates. Cannot calculate shipping price."
      )
    }

    // Prefer negotiated rates if available (account-specific discounts)
    const totalStr =
      rated.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ??
      rated.TotalCharges.MonetaryValue

    const calculatedAmount = parseFloat(totalStr)

    // Cache the result
    pruneRateCache()
    rateCache.set(cacheKey, {
      calculated_amount: calculatedAmount,
      timestamp: Date.now(),
    })

    return {
      calculated_amount: calculatedAmount,
      is_calculated_price_tax_inclusive: false,
    }
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<any> {
    // Lightweight validation — no UPS API call
    return { ...data }
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
        "Order is required to create a UPS fulfillment"
      )
    }

    const orderObj = order as any
    const fulfillmentData = fulfillment.data as any

    // Resolve the UPS service code from the shipping option
    const upsServiceCode =
      fulfillmentData?.ups_service_code ||
      (fulfillment as any).shipping_option?.data?.ups_service_code ||
      "03" // fallback to Ground

    // Build addresses from order
    const shippingAddress = orderObj.shipping_address
    const fromAddress = orderObj.shipping_methods?.[0]?.shipping_option
      ?.fulfillment_provider?.data?.from_address

    if (!shippingAddress) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Order shipping address is required for UPS fulfillment"
      )
    }

    const shipTo = this.buildUpsAddress(shippingAddress)
    // Use from_address from config or fall back to order data
    const shipFrom: UpsAddress = fromAddress
      ? this.buildUpsAddress(fromAddress)
      : {
          AddressLine: [process.env.SHIP_FROM_ADDRESS_1 || ""],
          City: process.env.SHIP_FROM_CITY || "",
          StateProvinceCode: process.env.SHIP_FROM_STATE || "",
          PostalCode: process.env.SHIP_FROM_POSTAL || "",
          CountryCode: process.env.SHIP_FROM_COUNTRY || "US",
        }

    // Collect items to fulfill
    const orderItems = orderObj.items || []
    const itemsToFulfill: OrderLineItemDTO[] = []
    for (const item of items) {
      const lineItemId = (item as any).line_item_id
      const orderItem = orderItems.find((i: any) => i.id === lineItemId)
      if (orderItem) {
        itemsToFulfill.push({
          ...orderItem,
          quantity: (item as any).quantity,
        })
      }
    }

    const packInputs: PackInput[] = itemsToFulfill.map((item) => ({
      variant_id: (item as any).variant_id ?? null,
      quantity: Number((item as any).quantity) || 0,
      weight: (item as any).variant?.weight ?? null,
      length: (item as any).variant?.length ?? null,
      width: (item as any).variant?.width ?? null,
      height: (item as any).variant?.height ?? null,
    }))
    const packed = packCart(packInputs)
    if (packed.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot create UPS shipment: order has no items or items lack weights."
      )
    }
    const upsPackages = packed.map((p, idx) => ({
      ...this.packageToUpsPackage(p),
      Description: `Order ${orderObj.display_id || orderObj.id} (pkg ${idx + 1}/${packed.length})`,
    }))

    const shipmentResponse = await this.client.createShipment({
      ShipmentRequest: {
        Request: {
          SubVersion: "2409",
          RequestOption: "nonvalidate",
        },
        Shipment: {
          Description: `Order ${orderObj.display_id || orderObj.id}`,
          Shipper: {
            Name: process.env.SHIP_FROM_NAME || "Arrotti Auto Parts",
            ShipperNumber: this.options_.account_number,
            Address: shipFrom,
          },
          ShipTo: {
            Name: [
              shippingAddress.first_name,
              shippingAddress.last_name,
            ]
              .filter(Boolean)
              .join(" "),
            Phone: shippingAddress.phone
              ? { Number: shippingAddress.phone }
              : undefined,
            Address: shipTo,
          },
          ShipFrom: {
            Name: process.env.SHIP_FROM_NAME || "Arrotti Auto Parts",
            Address: shipFrom,
          },
          PaymentInformation: {
            ShipmentCharge: [
              {
                Type: "01", // Transportation
                BillShipper: {
                  AccountNumber: this.options_.account_number,
                },
              },
            ],
          },
          Service: { Code: upsServiceCode },
          Package: upsPackages,
        },
        LabelSpecification: {
          LabelImageFormat: { Code: "GIF" },
          LabelStockSize: { Height: "6", Width: "4" },
        },
      },
    })

    const results = shipmentResponse.ShipmentResponse.ShipmentResults
    const packageResults = Array.isArray(results.PackageResults)
      ? results.PackageResults
      : [results.PackageResults]

    const labels = packageResults.map((r: any) => {
      const trackingNumber: string = r.TrackingNumber
      const labelBase64: string = r.ShippingLabel.GraphicImage
      return {
        tracking_number: trackingNumber,
        tracking_url: `https://www.ups.com/track?tracknum=${trackingNumber}`,
        label_url: `data:image/gif;base64,${labelBase64}`,
      }
    })
    const trackingNumbers = labels.map((l) => l.tracking_number)

    return {
      data: {
        ...((fulfillment.data as object) || {}),
        // Primary tracking number (first package) for legacy code paths that
        // read a single tracking number. All tracking numbers are in
        // tracking_numbers below.
        tracking_number: trackingNumbers[0],
        tracking_numbers: trackingNumbers,
        shipment_id: results.ShipmentIdentificationNumber,
        ups_service_code: upsServiceCode,
        package_count: packageResults.length,
      },
      labels,
    }
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    const { ups_service_code } = data as { ups_service_code?: string }
    return !!(ups_service_code && UPS_SERVICE_CODES.includes(ups_service_code))
  }

  async createReturnFulfillment(
    fulfillment: Record<string, unknown>
  ): Promise<any> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Return fulfillment is not supported by the UPS provider. Process returns manually."
    )
  }

  async cancelFulfillment(data: Record<string, unknown>): Promise<any> {
    const { tracking_number } = data as { tracking_number?: string }
    if (!tracking_number) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Tracking number is required to void a UPS shipment"
      )
    }
    await this.client.voidShipment(tracking_number)
  }
}

export default UpsProviderService
