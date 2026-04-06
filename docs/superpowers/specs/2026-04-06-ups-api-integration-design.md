# UPS Direct API Integration — Design Spec

## Goal

Add a direct UPS API fulfillment provider alongside the existing ShipStation integration. Both providers run side-by-side so customers see shipping options from each during checkout, enabling real-world pricing comparison. Once satisfied with UPS direct pricing, ShipStation is removed entirely.

## Motivation

- Compare UPS rates obtained directly vs. through ShipStation (which adds its own fees/markup)
- Long-term: replace ShipStation entirely with direct UPS integration to reduce costs and middleman dependency

## Scope

**In scope:**
- New `src/modules/ups/` fulfillment provider (rate calculation, label generation, tracking, void)
- UPS OAuth 2.0 authentication with token caching
- Rate result caching (same pattern as ShipStation)
- Registration as a second fulfillment provider in `medusa-config.ts`
- Label storage via S3 file service
- Support for: UPS Ground, 2nd Day Air, Next Day Air, Next Day Air Saver, 3 Day Select

**Out of scope:**
- Changes to existing ShipStation module
- Changes to storefronts (Medusa handles multi-provider display natively)
- Return fulfillment (manual, same as ShipStation)
- UPS Freight / international-specific services
- Admin UI changes

## Architecture

### Module Structure

```
src/modules/ups/
  index.ts      — ModuleProvider registration (Modules.FULFILLMENT)
  service.ts    — UpsProviderService extends AbstractFulfillmentProviderService
                   Injects fileModuleService from container for S3 label uploads
  client.ts     — UpsClient: OAuth 2.0 auth + REST API calls
  types.ts      — TypeScript types for UPS API contracts
```

Mirrors the existing ShipStation module pattern at `src/modules/shipstation/`.

### Provider Registration

In `medusa-config.ts`, the UPS provider registers conditionally alongside ShipStation:

```typescript
{
  resolve: "@medusajs/medusa/fulfillment",
  options: {
    providers: [
      { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
      // ShipStation (existing)
      ...(process.env.SHIPSTATION_API_KEY
        ? [{ resolve: "./src/modules/shipstation", id: "shipstation", options: { ... } }]
        : []),
      // UPS Direct (new)
      ...(process.env.UPS_CLIENT_ID
        ? [{
            resolve: "./src/modules/ups",
            id: "ups",
            options: {
              client_id: process.env.UPS_CLIENT_ID,
              client_secret: process.env.UPS_CLIENT_SECRET,
              account_number: process.env.UPS_ACCOUNT_NUMBER,
              base_url: process.env.UPS_BASE_URL || "https://onlinetools.ups.com",
            }
          }]
        : []),
    ]
  }
}
```

**Flip the switch:** Remove ShipStation entry from config, remove `UPS_CLIENT_ID` conditional guard.

## UPS API Integration Details

### Authentication

UPS REST API uses OAuth 2.0:
- `POST /security/v1/oauth/token` with `client_id` + `client_secret` (Basic auth header)
- Returns `access_token` with ~14400s TTL
- Token cached in memory, auto-refreshed before expiry

### API Endpoints

| Capability | UPS REST Endpoint | Service Method |
|---|---|---|
| Rate calculation | `POST /api/rating/v2403/Rate` | `calculatePrice()` |
| Shipment + label | `POST /api/shipments/v2409/ship` | `createFulfillment()` |
| Void shipment | `DELETE /api/shipments/v2409/void/cancel/{trackingNumber}` | `cancelFulfillment()` |
| Address validation | `POST /api/addressvalidation/v2` | Used internally |

### Supported Services

| Service | UPS Code | Customer-Facing Name |
|---|---|---|
| UPS Ground | `03` | UPS Ground (Direct) |
| UPS 2nd Day Air | `02` | UPS 2nd Day Air (Direct) |
| UPS Next Day Air | `01` | UPS Next Day Air (Direct) |
| UPS Next Day Air Saver | `13` | UPS Next Day Air Saver (Direct) |
| UPS 3 Day Select | `12` | UPS 3 Day Select (Direct) |

Services are hardcoded (not discovered dynamically). The "(Direct)" suffix distinguishes from ShipStation's UPS options during the comparison phase; removed once ShipStation is dropped.

## Service Methods

### `getFulfillmentOptions()`

Returns the hardcoded service list. No API call — UPS services are fixed and tied to the account.

```typescript
return [
  { id: "ups__03", name: "UPS Ground (Direct)", ups_service_code: "03" },
  { id: "ups__02", name: "UPS 2nd Day Air (Direct)", ups_service_code: "02" },
  { id: "ups__01", name: "UPS Next Day Air (Direct)", ups_service_code: "01" },
  { id: "ups__13", name: "UPS Next Day Air Saver (Direct)", ups_service_code: "13" },
  { id: "ups__12", name: "UPS 3 Day Select (Direct)", ups_service_code: "12" },
]
```

### `calculatePrice()`

1. Check rate result cache — return immediately if hit
2. Build UPS RateRequest payload:
   - Shipper: from `context.from_location` (warehouse address + UPS account number)
   - ShipTo: from `context.shipping_address`
   - Package: aggregated weight/dimensions from cart items (same logic as ShipStation)
   - Service code from `optionData.ups_service_code`
3. Call UPS Rating API
4. Extract `TotalCharges` from response (transportation + service options)
5. Cache result (15min TTL, 500 max entries — same as ShipStation)
6. Return `{ calculated_amount, is_calculated_price_tax_inclusive: false }`

### `validateFulfillmentData()`

Validates that shipping address and package data are present. Does NOT call UPS Address Validation API — keeps this method lightweight, matching ShipStation's approach. Returns validated data passthrough.

### `createFulfillment()`

1. Build UPS ShipmentRequest payload with order items, addresses, service code
2. Call UPS Shipping API — creates shipment + generates label in one call
3. UPS returns label as base64-encoded GIF image
4. Upload decoded label to S3 via Medusa's file service
5. Return:
   - `tracking_number`
   - `tracking_url` → `https://www.ups.com/track?tracknum={tracking_number}`
   - `label_url` → S3 URL of the uploaded label

### `cancelFulfillment()`

Calls UPS Void Shipment API with the tracking number stored in fulfillment data.

### `createReturnFulfillment()`

Throws error — process returns manually (same as ShipStation).

### `validateOption()`

Checks that `ups_service_code` is present and is one of the 5 supported codes.

### `canCalculate()`

Returns `true`.

## Caching Strategy

**Rate result cache only** — single-tier, unlike ShipStation's dual-tier:
- Key: `rate:ups:{service_code}:{postal_code}:{country_code}:{items_hash}:{currency_code}`
- Value: `{ calculated_amount, is_tax_inclusive, timestamp }`
- TTL: 15 minutes, max 500 entries
- Same prune logic as ShipStation

No shipment cache needed — UPS Rating and Shipping are independent API calls (unlike ShipStation's create-shipment-then-get-rates flow).

## Label Handling

UPS returns labels as base64-encoded image data (GIF format by default). Since the rest of the system expects URL-based labels (matching ShipStation behavior):

1. Decode base64 label data from UPS response
2. Upload to S3 via Medusa's file service (`fileModuleService.createFiles()`)
3. Return the S3 URL as `label_url`

Requested label format: GIF (default) — universally printable. ZPL available if thermal printers are used.

## Weight & Dimension Mapping

Reuses existing `SHIPPING_WEIGHT_UNIT` and `SHIPPING_DIMENSION_UNIT` env vars. Mapped to UPS values:

| Env Value | UPS Weight Unit | UPS Dimension Unit |
|---|---|---|
| `pound` | `LBS` | — |
| `kilogram` | `KGS` | — |
| `inch` | — | `IN` |
| `centimeter` | — | `CM` |

Same item aggregation logic as ShipStation: accumulate weight and height per quantity, maximize length and width.

## Environment Variables

**New (required when UPS enabled):**

```bash
UPS_CLIENT_ID=          # From UPS Developer Portal
UPS_CLIENT_SECRET=      # From UPS Developer Portal
UPS_ACCOUNT_NUMBER=     # UPS shipper account number
```

**New (optional):**

```bash
UPS_BASE_URL=https://onlinetools.ups.com   # Production (default)
# Use https://wwwcie.ups.com for sandbox/testing
```

**Existing (reused, no changes):**

```bash
SHIPPING_WEIGHT_UNIT=pound
SHIPPING_DIMENSION_UNIT=inch
```

## UPS Developer Portal Setup (Prerequisite)

1. Go to developer.ups.com — create account or log in
2. Create a new application → receive `client_id` and `client_secret`
3. Link your UPS shipper account number to the application
4. Start with sandbox URL (`https://wwwcie.ups.com`) for testing
5. Switch to production URL (`https://onlinetools.ups.com`) when ready

## Error Handling

- OAuth token refresh failures: retry once, then throw with clear message
- Rate API errors: throw `MedusaError` with UPS error description (same pattern as ShipStation)
- Shipping API errors: throw with UPS error code + description
- Network timeouts: 30s timeout (same as ShipStation), abort + throw on timeout
- Missing weight: throw same error as ShipStation ("product weights are not configured")

## Testing

- Unit tests for `UpsClient` methods with mocked HTTP responses
- Unit tests for weight/dimension aggregation and unit mapping
- Unit tests for OAuth token caching and refresh logic
- Integration test: `calculatePrice()` with sandbox API (requires sandbox credentials)

## Changes Summary

| What | Action |
|---|---|
| `src/modules/ups/index.ts` | New file — module provider registration |
| `src/modules/ups/service.ts` | New file — fulfillment provider service |
| `src/modules/ups/client.ts` | New file — UPS REST API client |
| `src/modules/ups/types.ts` | New file — TypeScript type definitions |
| `medusa-config.ts` | Edit — add UPS provider to fulfillment providers array |
| `.env` / `.env.template` | Edit — add UPS env vars |
| Existing ShipStation code | No changes |
| Storefront code | No changes |
| Subscribers | No changes |
