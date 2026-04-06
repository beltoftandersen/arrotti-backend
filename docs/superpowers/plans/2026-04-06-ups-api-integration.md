# UPS Direct API Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UPS direct fulfillment provider alongside ShipStation so customers see both sets of shipping options during checkout for real-world pricing comparison, with the ability to drop ShipStation later.

**Architecture:** New `src/modules/ups/` fulfillment provider mirroring the existing `src/modules/shipstation/` pattern. Implements `AbstractFulfillmentProviderService` with 4 files: types, client (OAuth 2.0 + REST), service, and module registration. Registered conditionally in `medusa-config.ts` based on env vars.

**Tech Stack:** TypeScript, Medusa V2 Fulfillment Provider API, UPS REST API (OAuth 2.0), native `fetch()`

**Spec:** `docs/superpowers/specs/2026-04-06-ups-api-integration-design.md`

---

## File Structure

```
src/modules/ups/
  types.ts      — UPS API request/response TypeScript types
  client.ts     — UpsClient: OAuth 2.0 token management + REST API calls
  service.ts    — UpsProviderService extends AbstractFulfillmentProviderService
  index.ts      — ModuleProvider registration
```

**Modified files:**
- `medusa-config.ts` — Add UPS provider to fulfillment providers array
- `.env.template` — Add UPS env var placeholders

---

### Task 1: UPS API Type Definitions

**Files:**
- Create: `src/modules/ups/types.ts`

- [ ] **Step 1: Create the UPS types file**

This file defines all TypeScript types for UPS REST API request and response contracts. These types are used by the client and service.

```typescript
// src/modules/ups/types.ts

// --- Configuration ---

export type UpsOptions = {
  client_id: string
  client_secret: string
  account_number: string
  base_url?: string
}

// --- OAuth ---

export type OAuthTokenResponse = {
  token_type: string
  issued_at: string
  client_id: string
  access_token: string
  expires_in: string // seconds as string
  status: string
}

// --- Common ---

export type UpsAddress = {
  AddressLine: string[]
  City: string
  StateProvinceCode: string
  PostalCode: string
  CountryCode: string
}

export type UpsWeight = {
  UnitOfMeasurement: {
    Code: "LBS" | "KGS"
    Description?: string
  }
  Weight: string // numeric string
}

export type UpsDimensions = {
  UnitOfMeasurement: {
    Code: "IN" | "CM"
    Description?: string
  }
  Length: string
  Width: string
  Height: string
}

export type UpsPackage = {
  PackagingType: {
    Code: string // "02" = Customer Supplied Package
    Description?: string
  }
  PackageWeight: UpsWeight
  Dimensions?: UpsDimensions
}

export type UpsService = {
  Code: string
  Description?: string
}

// --- Rating ---

export type RateRequest = {
  RateRequest: {
    Request: {
      SubVersion?: string
      TransactionReference?: {
        CustomerContext?: string
      }
    }
    Shipment: {
      Shipper: {
        Name?: string
        ShipperNumber: string
        Address: UpsAddress
      }
      ShipTo: {
        Name?: string
        Address: UpsAddress
      }
      ShipFrom: {
        Name?: string
        Address: UpsAddress
      }
      Service: UpsService
      Package: UpsPackage[]
    }
  }
}

export type RateResponseBody = {
  RateResponse: {
    Response: {
      ResponseStatus: {
        Code: string
        Description: string
      }
      Alert?: {
        Code: string
        Description: string
      }[]
    }
    RatedShipment: {
      Service: UpsService
      TotalCharges: {
        CurrencyCode: string
        MonetaryValue: string // numeric string e.g. "12.50"
      }
      TransportationCharges: {
        CurrencyCode: string
        MonetaryValue: string
      }
      ServiceOptionsCharges: {
        CurrencyCode: string
        MonetaryValue: string
      }
      NegotiatedRateCharges?: {
        TotalCharge: {
          CurrencyCode: string
          MonetaryValue: string
        }
      }
    }
  }
}

// --- Shipping ---

export type ShipmentRequest = {
  ShipmentRequest: {
    Request: {
      SubVersion?: string
      RequestOption: "nonvalidate" | "validate"
      TransactionReference?: {
        CustomerContext?: string
      }
    }
    Shipment: {
      Description?: string
      Shipper: {
        Name?: string
        ShipperNumber: string
        Address: UpsAddress
      }
      ShipTo: {
        Name?: string
        Phone?: {
          Number: string
        }
        Address: UpsAddress
      }
      ShipFrom: {
        Name?: string
        Address: UpsAddress
      }
      PaymentInformation: {
        ShipmentCharge: {
          Type: "01" // Transportation
          BillShipper: {
            AccountNumber: string
          }
        }[]
      }
      Service: UpsService
      Package: (UpsPackage & {
        Description?: string
      })[]
    }
    LabelSpecification: {
      LabelImageFormat: {
        Code: "GIF" | "PNG" | "ZPL"
      }
      LabelStockSize?: {
        Height: string
        Width: string
      }
    }
  }
}

export type ShipmentResponseBody = {
  ShipmentResponse: {
    Response: {
      ResponseStatus: {
        Code: string
        Description: string
      }
      Alert?: {
        Code: string
        Description: string
      }[]
    }
    ShipmentResults: {
      ShipmentCharges: {
        TotalCharges: {
          CurrencyCode: string
          MonetaryValue: string
        }
        TransportationCharges: {
          CurrencyCode: string
          MonetaryValue: string
        }
        ServiceOptionsCharges: {
          CurrencyCode: string
          MonetaryValue: string
        }
      }
      NegotiatedRateCharges?: {
        TotalCharge: {
          CurrencyCode: string
          MonetaryValue: string
        }
      }
      ShipmentIdentificationNumber: string
      PackageResults:
        | {
            TrackingNumber: string
            ShippingLabel: {
              ImageFormat: {
                Code: string
              }
              GraphicImage: string // base64 encoded
            }
          }
        | {
            TrackingNumber: string
            ShippingLabel: {
              ImageFormat: {
                Code: string
              }
              GraphicImage: string
            }
          }[]
    }
  }
}

// --- Void ---

export type VoidRequest = {
  trackingNumber: string
}

export type VoidResponseBody = {
  VoidShipmentResponse: {
    Response: {
      ResponseStatus: {
        Code: string
        Description: string
      }
    }
    SummaryResult: {
      Status: {
        Code: string
        Description: string
      }
    }
  }
}

// --- Error ---

export type UpsErrorResponse = {
  response?: {
    errors?: {
      code: string
      message: string
    }[]
  }
}

// --- Service Map ---

export const UPS_SERVICES: Record<string, string> = {
  "01": "UPS Next Day Air (Direct)",
  "02": "UPS 2nd Day Air (Direct)",
  "03": "UPS Ground (Direct)",
  "12": "UPS 3 Day Select (Direct)",
  "13": "UPS Next Day Air Saver (Direct)",
}

export const UPS_SERVICE_CODES = Object.keys(UPS_SERVICES)
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/ups/types.ts
git commit -m "feat(ups): add UPS API type definitions"
```

---

### Task 2: UPS API Client

**Files:**
- Create: `src/modules/ups/client.ts`
- Reference: `src/modules/ups/types.ts` (from Task 1)
- Reference: `src/modules/shipstation/client.ts` (pattern to follow)

- [ ] **Step 1: Create the UPS client**

This client handles OAuth 2.0 token management and all UPS REST API calls. It mirrors the ShipStation client's pattern (native `fetch()`, 30s timeout, structured error handling).

```typescript
// src/modules/ups/client.ts

import { MedusaError } from "@medusajs/framework/utils"
import {
  UpsOptions,
  OAuthTokenResponse,
  RateRequest,
  RateResponseBody,
  ShipmentRequest,
  ShipmentResponseBody,
  VoidResponseBody,
} from "./types"

const DEFAULT_BASE_URL = "https://onlinetools.ups.com"
const REQUEST_TIMEOUT_MS = 30_000
// Refresh 5 minutes before expiry to avoid edge-case failures
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export class UpsClient {
  protected options: UpsOptions
  protected baseUrl: string
  private accessToken: string | null = null
  private tokenExpiresAt: number = 0

  constructor(options: UpsOptions) {
    this.options = options
    this.baseUrl = options.base_url || DEFAULT_BASE_URL
  }

  /**
   * Get a valid OAuth access token, refreshing if needed.
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken
    }

    const credentials = Buffer.from(
      `${this.options.client_id}:${this.options.client_secret}`
    ).toString("base64")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let resp: Response
    try {
      resp = await fetch(`${this.baseUrl}/security/v1/oauth/token`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      })
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "UPS OAuth token request timed out"
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (!resp.ok) {
      let detail = `${resp.status} ${resp.statusText}`
      try {
        const body = await resp.json()
        if (body?.response?.errors?.length) {
          detail = body.response.errors
            .map((e: any) => e.message)
            .join(", ")
        }
      } catch {}
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `UPS OAuth error: ${detail}`
      )
    }

    const data: OAuthTokenResponse = await resp.json()
    this.accessToken = data.access_token
    const expiresInMs = parseInt(data.expires_in, 10) * 1000
    this.tokenExpiresAt = Date.now() + expiresInMs - TOKEN_REFRESH_BUFFER_MS

    return this.accessToken
  }

  /**
   * Send an authenticated request to the UPS REST API.
   */
  private async sendRequest(
    url: string,
    init?: RequestInit
  ): Promise<any> {
    const token = await this.getAccessToken()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let resp: Response
    try {
      resp = await fetch(`${this.baseUrl}${url}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          transId: `medusa-${Date.now()}`,
          transactionSrc: "medusa",
        },
      })
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `UPS request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (!resp.ok) {
      let errorDetail = `${resp.status} ${resp.statusText}`
      try {
        const body = await resp.json()
        if (body?.response?.errors?.length) {
          errorDetail = body.response.errors
            .map((e: any) => `${e.code}: ${e.message}`)
            .join(", ")
        }
      } catch {}
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `UPS API error (${resp.status}): ${errorDetail}`
      )
    }

    return resp.json()
  }

  /**
   * Get shipping rates for a shipment.
   * UPS Rating API v2403
   */
  async getRates(data: RateRequest): Promise<RateResponseBody> {
    return this.sendRequest(
      "/api/rating/v2403/Rate",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    )
  }

  /**
   * Create a shipment and purchase a label.
   * UPS Shipping API v2409
   */
  async createShipment(
    data: ShipmentRequest
  ): Promise<ShipmentResponseBody> {
    return this.sendRequest(
      "/api/shipments/v2409/ship",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    )
  }

  /**
   * Void a shipment by tracking number.
   * UPS Shipping API v2409
   */
  async voidShipment(trackingNumber: string): Promise<VoidResponseBody> {
    return this.sendRequest(
      `/api/shipments/v2409/void/cancel/${trackingNumber}`,
      { method: "DELETE" }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/ups/client.ts
git commit -m "feat(ups): add UPS REST API client with OAuth 2.0"
```

---

### Task 3: UPS Fulfillment Provider Service

**Files:**
- Create: `src/modules/ups/service.ts`
- Reference: `src/modules/ups/types.ts` (from Task 1)
- Reference: `src/modules/ups/client.ts` (from Task 2)
- Reference: `src/modules/shipstation/service.ts` (pattern to follow — caching, weight aggregation, error handling)

- [ ] **Step 1: Create the UPS fulfillment provider service**

This is the main service that Medusa calls for rate calculation, fulfillment creation, etc. It mirrors ShipStation's service structure.

```typescript
// src/modules/ups/service.ts

import {
  AbstractFulfillmentProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CartLineItemDTO,
  CreateShippingOptionDTO,
  FulfillmentOption,
  OrderLineItemDTO,
  StockLocationAddressDTO,
  CartAddressDTO,
} from "@medusajs/framework/types"
import { UpsClient } from "./client"
import {
  UpsOptions,
  UpsAddress,
  UpsPackage,
  UPS_SERVICES,
  UPS_SERVICE_CODES,
} from "./types"

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

  /**
   * Aggregate item weights and dimensions, same logic as ShipStation.
   * Accumulates weight and height per quantity, maximizes length and width.
   */
  private aggregatePackage(
    items: CartLineItemDTO[] | OrderLineItemDTO[]
  ): UpsPackage {
    let totalWeight = 0
    let maxLength = 0
    let maxWidth = 0
    let totalHeight = 0

    for (const item of items) {
      // @ts-ignore - variant object is available at runtime
      const variant = item.variant
      const qty = Number(item.quantity) || 1
      totalWeight += (variant?.weight || 0) * qty
      maxLength = Math.max(maxLength, variant?.length || 0)
      maxWidth = Math.max(maxWidth, variant?.width || 0)
      totalHeight += (variant?.height || 0) * qty
    }

    if (totalWeight === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot calculate shipping: product weights are not configured. " +
          "Please set weights on product variants or category shipping defaults."
      )
    }

    const envWeightUnit = (process.env.SHIPPING_WEIGHT_UNIT ||
      "pound") as WeightUnit
    const envDimensionUnit = (process.env.SHIPPING_DIMENSION_UNIT ||
      "inch") as DimensionUnit

    const upsWeightUnit = WEIGHT_UNIT_MAP[envWeightUnit] || "LBS"
    const upsDimensionUnit = DIMENSION_UNIT_MAP[envDimensionUnit] || "IN"
    const conversionFactor = WEIGHT_CONVERSION[envWeightUnit] || 1

    const convertedWeight = totalWeight * conversionFactor

    const pkg: UpsPackage = {
      PackagingType: {
        Code: "02", // Customer Supplied Package
        Description: "Package",
      },
      PackageWeight: {
        UnitOfMeasurement: { Code: upsWeightUnit },
        Weight: convertedWeight.toFixed(1),
      },
    }

    if (maxLength > 0 && maxWidth > 0 && totalHeight > 0) {
      pkg.Dimensions = {
        UnitOfMeasurement: { Code: upsDimensionUnit },
        Length: maxLength.toFixed(1),
        Width: maxWidth.toFixed(1),
        Height: totalHeight.toFixed(1),
      }
    }

    return pkg
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
    const pkg = this.aggregatePackage(
      (context.items || []) as CartLineItemDTO[]
    )

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
          Package: [pkg],
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

    const pkg = this.aggregatePackage(itemsToFulfill)

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
          Package: [
            {
              ...pkg,
              Description: `Order ${orderObj.display_id || orderObj.id}`,
            },
          ],
        },
        LabelSpecification: {
          LabelImageFormat: { Code: "GIF" },
          LabelStockSize: { Height: "6", Width: "4" },
        },
      },
    })

    const results = shipmentResponse.ShipmentResponse.ShipmentResults
    const packageResult = Array.isArray(results.PackageResults)
      ? results.PackageResults[0]
      : results.PackageResults

    const trackingNumber = packageResult.TrackingNumber
    const labelBase64 = packageResult.ShippingLabel.GraphicImage
    const labelDataUri = `data:image/gif;base64,${labelBase64}`

    return {
      data: {
        ...((fulfillment.data as object) || {}),
        tracking_number: trackingNumber,
        shipment_id: results.ShipmentIdentificationNumber,
        ups_service_code: upsServiceCode,
      },
      labels: [
        {
          tracking_number: trackingNumber,
          tracking_url: `https://www.ups.com/track?tracknum=${trackingNumber}`,
          label_url: labelDataUri,
        },
      ],
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/ups/service.ts
git commit -m "feat(ups): add UPS fulfillment provider service"
```

---

### Task 4: Module Registration

**Files:**
- Create: `src/modules/ups/index.ts`

- [ ] **Step 1: Create the module provider index**

```typescript
// src/modules/ups/index.ts

import UpsProviderService from "./service"
import { ModuleProvider, Modules } from "@medusajs/framework/utils"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [UpsProviderService],
})
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/ups/index.ts
git commit -m "feat(ups): add module provider registration"
```

---

### Task 5: Register UPS Provider in Medusa Config

**Files:**
- Modify: `medusa-config.ts:158-185` (fulfillment module section)

- [ ] **Step 1: Add UPS provider to the fulfillment providers array**

In `medusa-config.ts`, find the fulfillment module block (around line 158) and add the UPS provider after ShipStation:

```typescript
    // Fulfillment module with manual + ShipStation + UPS providers
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          // Default manual provider
          {
            resolve: "@medusajs/medusa/fulfillment-manual",
            id: "manual",
          },
          // ShipStation provider (only enabled when API key is set)
          ...(process.env.SHIPSTATION_API_KEY
            ? [
                {
                  resolve: "./src/modules/shipstation",
                  id: "shipstation",
                  options: {
                    api_key: process.env.SHIPSTATION_API_KEY,
                    ...(process.env.SHIPSTATION_BASE_URL && {
                      base_url: process.env.SHIPSTATION_BASE_URL,
                    }),
                  },
                },
              ]
            : []),
          // UPS Direct provider (only enabled when client ID is set)
          ...(process.env.UPS_CLIENT_ID
            ? [
                {
                  resolve: "./src/modules/ups",
                  id: "ups",
                  options: {
                    client_id: process.env.UPS_CLIENT_ID,
                    client_secret: process.env.UPS_CLIENT_SECRET,
                    account_number: process.env.UPS_ACCOUNT_NUMBER,
                    ...(process.env.UPS_BASE_URL && {
                      base_url: process.env.UPS_BASE_URL,
                    }),
                  },
                },
              ]
            : []),
        ],
      },
    },
```

The exact edit: replace the old fulfillment block (lines 158-185) with the expanded version above.

- [ ] **Step 2: Commit**

```bash
git add medusa-config.ts
git commit -m "feat(ups): register UPS fulfillment provider in medusa config"
```

---

### Task 6: Environment Variable Template

**Files:**
- Modify: `.env.template`

- [ ] **Step 1: Add UPS env var placeholders to `.env.template`**

Append these lines at the end of `.env.template`:

```bash
# UPS Direct API (OAuth 2.0)
UPS_CLIENT_ID=
UPS_CLIENT_SECRET=
UPS_ACCOUNT_NUMBER=
# UPS_BASE_URL=https://onlinetools.ups.com  # Production (default). Use https://wwwcie.ups.com for sandbox.
```

- [ ] **Step 2: Commit**

```bash
git add .env.template
git commit -m "feat(ups): add UPS env vars to .env.template"
```

---

### Task 7: Verify Build & Manual Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript build to catch type errors**

```bash
cd /var/www/arrotti/my-medusa-store && npm run build
```

Expected: Build succeeds with no errors related to `src/modules/ups/`.

- [ ] **Step 2: Verify the module loads without UPS credentials**

Start the dev server without UPS env vars set — the UPS provider should be skipped (conditional on `UPS_CLIENT_ID`):

```bash
cd /var/www/arrotti/my-medusa-store && npm run dev
```

Expected: Server starts normally. No UPS-related errors. ShipStation and manual fulfillment still work.

- [ ] **Step 3: Verify the module loads with UPS sandbox credentials**

Set the UPS env vars in `.env` (use sandbox URL for testing):

```bash
UPS_CLIENT_ID=<your_client_id>
UPS_CLIENT_SECRET=<your_client_secret>
UPS_ACCOUNT_NUMBER=<your_account_number>
UPS_BASE_URL=https://wwwcie.ups.com
```

Restart dev server. Expected: Server starts. UPS fulfillment options appear alongside ShipStation options when creating shipping options in admin.

- [ ] **Step 4: Commit any fixes if needed**

If the build or smoke test revealed issues, fix them and commit:

```bash
git add -A
git commit -m "fix(ups): address build/smoke test issues"
```
