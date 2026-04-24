import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { MeilisearchPluginOptions } from '@rokmohar/medusa-plugin-meilisearch'
import { generateFitmentText, getVehicleInfoBatch } from './src/lib/vehicle-lookup'
import { getProductPriceCents } from './src/lib/price-lookup'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Require a secret environment variable - fail secure if not set.
 */
function requireSecret(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `SECURITY ERROR: ${name} environment variable is not set. ` +
      `This is required for secure operation.`
    )
  }
  return value
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: requireSecret("JWT_SECRET"),
      cookieSecret: requireSecret("COOKIE_SECRET"),
    },
  },
  modules: [
    // Redis event bus — durable pub/sub for subscribers (quote notifications, order events, etc.)
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
        jobOptions: {
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 3600, count: 1000 },
        },
      },
    },
    // Redis caching module — caches regions, variants, price sets, customers, etc.
    // Significantly speeds up cart operations (v2.11.0+)
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: {
              redisUrl: process.env.REDIS_URL,
            },
          },
        ],
      },
    },
    {
      resolve: "./src/modules/fitment",
    },
    {
      resolve: "./src/modules/garage",
    },
    {
      resolve: "./src/modules/brand",
    },
    {
      resolve: "./src/modules/supplier",
    },
    {
      resolve: "./src/modules/product-review",
    },
    {
      resolve: "./src/modules/quote",
    },
    {
      resolve: "./src/modules/qbo-connection",
    },
    // ZIP-code-level US sales tax provider
    {
      resolve: "@medusajs/medusa/tax",
      options: {
        providers: [
          {
            resolve: "./src/modules/zip-tax",
            id: "zip-tax",
          },
        ],
      },
    },
    // Stripe payment provider
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
          {
            resolve: "./src/modules/payment-cod-zelle",
            id: "cod-zelle",
            options: {},
          },
        ],
      },
    },
    // Notification module with SMTP provider (supports AWS SES SMTP, SendGrid, etc.)
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          // Local provider for non-email notifications
          {
            resolve: "@medusajs/medusa/notification-local",
            id: "local",
            options: {
              name: "Local Notification Provider",
              channels: ["feed"],
            },
          },
          // SMTP provider for email
          ...(process.env.SMTP_HOST
            ? [
                {
                  resolve: "./src/modules/notification-smtp",
                  id: "smtp",
                  options: {
                    channels: ["email"],
                    host: process.env.SMTP_HOST,
                    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
                    secure: process.env.SMTP_SECURE === "true",
                    username: process.env.SMTP_USERNAME,
                    password: process.env.SMTP_PASSWORD,
                    from: process.env.SMTP_FROM_EMAIL,
                    fromName: process.env.SMTP_FROM_NAME,
                  },
                },
              ]
            : [
                // Fallback to local for email if SMTP not configured
                {
                  resolve: "@medusajs/medusa/notification-local",
                  id: "local-email",
                  options: {
                    name: "Local Email Provider",
                    channels: ["email"],
                  },
                },
              ]),
        ],
      },
    },
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
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: process.env.S3_FILE_URL,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
              endpoint: process.env.S3_ENDPOINT,
              additional_client_config: {
                forcePathStyle: true,
              },
            },
          },
        ],
      },
    },
  ],
  plugins: [
    {
      resolve: "@rokmohar/medusa-plugin-meilisearch",
      options: {
        config: {
          host: process.env.MEILISEARCH_HOST ?? "",
          apiKey: process.env.MEILISEARCH_API_KEY ?? "",
        },
        settings: {
          products: {
            type: "products",
            enabled: true,
            fields: [
              "id",
              "title",
              "description",
              "handle",
              "thumbnail",
              "metadata",
              "created_at",
              "categories.id",
              "categories.handle",
              "categories.parent_category.id",
              "categories.parent_category.parent_category.id",
              "categories.parent_category.parent_category.parent_category.id",
              "collection_id",
              "fitments.vehicle_id",
              "fitments.submodels",
              "fitments.conditions",
              "brand.id",
              "brand.name",
              "sales_channels.id",
              "variants.sku",
            ],
            transformer: async (product: any, defaultTransform: any, options: any) => {
              const transformed = defaultTransform(product, options)
              // Collect all category IDs including ancestors (so product in "Front Bumpers" also appears in "Bumpers")
              const allCategoryIds = new Set<string>()
              if (Array.isArray(product?.categories)) {
                for (const category of product.categories) {
                  // Walk up the category tree
                  let current = category
                  while (current?.id) {
                    allCategoryIds.add(current.id)
                    current = current.parent_category
                  }
                }
              }
              const categoryIds = Array.from(allCategoryIds)

              // Pick the lexicographically smallest leaf category handle.
              // Partslink numeric prefixes (e.g. 1000-1000, 1000-1025) make
              // "main" categories sort before supportive ones naturally, so
              // this doubles as a category-priority tiebreaker downstream.
              const directCategoryHandles = Array.isArray(product?.categories)
                ? (product.categories as any[])
                    .map((c) => c?.handle as string | undefined)
                    .filter((h): h is string => !!h)
                : []
              const primaryCategoryHandle = directCategoryHandles.length > 0
                ? [...directCategoryHandles].sort()[0]
                : null

              // Extract vehicle_ids, submodels, and conditions from fitments
              const vehicleIds: string[] = []
              const submodelsSet = new Set<string>()
              const conditionsSet = new Set<string>()
              // Group fitments by vehicle_id for structured data
              const byVehicle = new Map<string, { submodels: Set<string>; conditions: Set<string> }>()

              if (Array.isArray(product?.fitments)) {
                for (const f of product.fitments) {
                  if (f?.vehicle_id) {
                    vehicleIds.push(f.vehicle_id)
                    if (!byVehicle.has(f.vehicle_id)) {
                      byVehicle.set(f.vehicle_id, { submodels: new Set(), conditions: new Set() })
                    }
                    const entry = byVehicle.get(f.vehicle_id)!
                    if (Array.isArray(f?.submodels)) {
                      for (const s of f.submodels) {
                        if (typeof s === 'string' && s.trim()) {
                          entry.submodels.add(s.trim())
                        }
                      }
                    }
                    if (typeof f?.conditions === 'string' && f.conditions.trim()) {
                      entry.conditions.add(f.conditions.trim())
                    }
                  }
                  // Collect flat sets for filtering (backward compat)
                  if (Array.isArray(f?.submodels)) {
                    for (const s of f.submodels) {
                      if (typeof s === 'string' && s.trim()) {
                        submodelsSet.add(s.trim())
                      }
                    }
                  }
                  if (typeof f?.conditions === 'string' && f.conditions.trim()) {
                    conditionsSet.add(f.conditions.trim())
                  }
                }
              }

              const uniqueVehicleIds = [...new Set(vehicleIds)]
              const submodels = Array.from(submodelsSet)
              const conditions = Array.from(conditionsSet)

              // Generate fitment_text (e.g., "2020 Toyota Camry")
              const fitmentText = uniqueVehicleIds.length > 0
                ? await generateFitmentText(uniqueVehicleIds)
                : []

              // Build structured fitments array with vehicle info
              const vehicleInfoMap = uniqueVehicleIds.length > 0
                ? await getVehicleInfoBatch(uniqueVehicleIds)
                : new Map()
              const structuredFitments = Array.from(byVehicle.entries()).map(([vid, data]) => {
                const vInfo = vehicleInfoMap.get(vid)
                const years = vInfo
                  ? (vInfo.year_start === vInfo.year_end ? `${vInfo.year_start}` : `${vInfo.year_start}-${vInfo.year_end}`)
                  : ""
                return {
                  vehicle_id: vid,
                  vehicle: vInfo ? `${years} ${vInfo.make} ${vInfo.model}` : vid,
                  years,
                  make: vInfo?.make ?? "",
                  model: vInfo?.model ?? "",
                  submodels: Array.from(data.submodels),
                  conditions: Array.from(data.conditions),
                }
              })

              // Searchable per-fitment vehicle strings (one entry per fitment, not
              // per year). Ranked above fitment_text so exact model matches win —
              // e.g. query "toyota corolla 2022" prefers "COROLLA" over the
              // longer "COROLLA CROSS" match despite extra year entries in
              // fitment_text.
              const vehicleStrings = structuredFitments
                .map((f) => f.vehicle)
                .filter((v): v is string => !!v && v !== "")
              // Min token count across fitments — used as a tiebreaker so the
              // shorter vehicle string wins on equal-score ties (Corolla with
              // 4 tokens beats Corolla Cross with 5).
              const vehicleTokenCount = vehicleStrings.length > 0
                ? Math.min(
                    ...vehicleStrings.map(
                      (v) => v.split(/[\s-]+/).filter(Boolean).length
                    )
                  )
                : 0

              // Extract brand info from linked brand
              const brandId = product?.brand?.id ?? null
              const brandName = product?.brand?.name ?? null

              // Extract sales_channel_ids
              const salesChannelIds = Array.isArray(product?.sales_channels)
                ? product.sales_channels
                    .map((sc: any) => sc?.id)
                    .filter(Boolean)
                : []

              // Extract part numbers from metadata for search
              const metadata = product?.metadata as Record<string, string> | undefined
              const oemNumber = metadata?.oem ?? null
              const partslinkNo = metadata?.partslink_no ?? null

              // Extract variant SKUs for search
              const variantSkus: string[] = []
              if (Array.isArray(product?.variants)) {
                for (const v of product.variants) {
                  if (v?.sku && typeof v.sku === 'string') {
                    variantSkus.push(v.sku)
                  }
                }
              }

              // Convert created_at to Unix timestamp for sorting
              const createdAtTimestamp = product?.created_at
                ? Math.floor(new Date(product.created_at).getTime() / 1000)
                : 0

              // Look up price for this product (cached in memory)
              const priceCents = product?.id
                ? await getProductPriceCents(product.id)
                : null

              return {
                ...transformed,
                category_id: categoryIds.length ? categoryIds : null,
                primary_category_handle: primaryCategoryHandle,
                collection_id:
                  product?.collection_id ?? product?.collection?.id ?? null,
                vehicle_ids: uniqueVehicleIds,
                vehicle: vehicleStrings,
                vehicle_token_count: vehicleTokenCount,
                fitment_text: fitmentText,
                submodels: submodels,
                conditions: conditions,
                fitments: structuredFitments,
                brand_id: brandId,
                brand_name: brandName,
                sales_channel_ids: salesChannelIds,
                oem_number: oemNumber,
                partslink_no: partslinkNo,
                variant_skus: variantSkus,
                created_at: createdAtTimestamp,
                price_cents: priceCents,
                avg_rating: 0,
                is_quote_only: !!(product?.metadata as any)?.is_quote_only,
              }
            },
            indexSettings: {
              searchableAttributes: ["title", "vehicle", "description", "fitment_text", "oem_number", "partslink_no", "variant_skus", "submodels", "conditions"],
              displayedAttributes: [
                "id",
                "handle",
                "title",
                "description",
                "thumbnail",
                "fitment_text",
                "vehicle",
                "primary_category_handle",
                "category_id",
                "collection_id",
                "vehicle_ids",
                "submodels",
                "conditions",
                "fitments",
                "brand_id",
                "brand_name",
                "sales_channel_ids",
                "oem_number",
                "partslink_no",
                "variant_skus",
                "created_at",
                "price_cents",
                "avg_rating",
                "is_quote_only",
              ],
              filterableAttributes: [
                "id",
                "handle",
                "vehicle_ids",
                "category_id",
                "collection_id",
                "brand_id",
                "sales_channel_ids",
                "submodels",
                "conditions",
                "price_cents",
                "avg_rating",
                "is_quote_only",
                "oem_number",
                "partslink_no",
                "variant_skus",
              ],
              sortableAttributes: [
                "created_at",
                "title",
                "price_cents",
                "avg_rating",
                "vehicle_token_count",
                "primary_category_handle",
                "is_quote_only",
              ],
              // Tiebreakers appended after Meilisearch defaults:
              // - vehicle_token_count:asc — shorter vehicle strings win
              //   ("TOYOTA COROLLA" beats "TOYOTA COROLLA CROSS" on a
              //   "toyota corolla 2022" query)
              // - primary_category_handle:asc — Partslink numeric prefixes
              //   cluster same-category products together and order
              //   "main" parts (e.g. covers at 1000-1000) above supportive
              //   parts (retainers at 1000-1031, grilles at 1000-1036)
              rankingRules: [
                "words",
                "typo",
                "proximity",
                "attribute",
                "sort",
                "exactness",
                "vehicle_token_count:asc",
                "primary_category_handle:asc",
              ],
            },
            primaryKey: "id",
          },
        },
      } satisfies MeilisearchPluginOptions,
    },
  ],
  featureFlags: {
    caching: true,
  },
  admin: {
    backendUrl: "/",
    storefrontUrl: process.env.MEDUSA_STOREFRONT_URL || "https://arrottigroup.com",
    vite: (config) => {
      return {
        ...config,
        server: {
          ...config.server,
          host: "0.0.0.0",
          allowedHosts: [
            "localhost",
            ".localhost",
            "127.0.0.1",
            "carparts.chimkins.com",
          ],
          hmr: false,
        },
      }
    },
  },
})
