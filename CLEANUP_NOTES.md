# Cleanup Notes

## Where things are
- VIN decode (VPIC): `src/api/store/vehicles/vin/decode/route.ts` + provider `src/modules/fitment/services/vin-decode-provider.ts`
- Fitment resolve (MMY -> vehicle_id / vehicle_ids): `src/api/store/vehicles/resolve/route.ts`
- Meili vehicle_ids indexing:
  - per-product update helper: `src/modules/fitment/services/meili-fitment.ts`
  - full reindex script: `src/scripts/meilisearch-reindex.ts`
- Storefront Meili vehicle filter wiring:
  - backend search filter: `src/api/store/products/search/route.ts`
  - storefront query builder: `/root/my-medusa-store-storefront/src/lib/data/products.ts`
  - PLP usage: `/root/my-medusa-store-storefront/src/modules/store/templates/paginated-products.tsx`
- Garage backend module + routes:
  - module: `src/modules/garage`
  - routes: `src/api/store/garage/route.ts`, `src/api/store/garage/[id]/route.ts`, `src/api/store/garage/touch/route.ts`
  - link: `src/links/customer-garage.ts`
- Garage frontend mode switch:
  - `/root/my-medusa-store-storefront/src/modules/vehicles/context/garage-context.tsx`

## Issues found
- Unused storefront component: `/root/my-medusa-store-storefront/src/modules/vehicles/components/vehicle-bar/index.tsx` not imported anywhere.
- Garage migrations include duplicate create-table migrations (`Migration20260116214934.ts` and `Migration20260210120000.ts`). Left untouched to avoid altering migration history.
- No evidence of vehicle filter being applied in cart/checkout; vehicle filtering is only in product listing/search.

## What I changed
- Removed unused `VehicleBar` component file to avoid dead code.
