import {
  defineMiddlewares,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import rateLimit from "express-rate-limit"
import multer from "multer"

// Multer for file uploads (memory storage for small files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 5, // Max 5 files
  },
})

/**
 * Rate limiters for store API routes.
 *
 * Uses in-memory store (appropriate for single-instance deployments).
 * For multi-instance, swap to rate-limit-redis.
 *
 * Key generation: Uses req.ip which respects Express's "trust proxy" setting
 * (Medusa sets trust proxy = 1). This correctly extracts the client IP from
 * the first x-forwarded-for hop set by nginx, and cannot be spoofed by
 * injecting extra x-forwarded-for headers.
 */

// Skip rate limiting for internal/localhost requests (Next.js SSR)
const isLocalhost = (req: any) => {
  const ip = req.ip || ""
  return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1"
}

// General store routes: 120 requests per minute per IP
const storeGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  skip: isLocalhost,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
})

// Search endpoint: 30 requests per minute per IP
// This is the most expensive endpoint and the primary scraping target
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many search requests, please slow down." },
})

// Vehicle endpoints: 60 requests per minute per IP
const vehicleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many vehicle lookup requests, please slow down." },
})

// VIN decode: 10 requests per minute per IP (external API dependency)
const vinDecodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many VIN decode requests, please slow down." },
})

// Contact form: 5 requests per 15 minutes per IP
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many contact submissions. Please try again later." },
})

// Review submission: 10 requests per 15 minutes per IP
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many review submissions. Please try again later." },
})

// Quote requests: 10 requests per 15 minutes per IP
const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many quote requests. Please try again later." },
})

// Wrap express-rate-limit for Medusa's middleware signature
const wrap = (limiter: any) => {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    limiter(req, res, next)
  }
}

// Cache-Control middleware for static reference data
// stale-while-revalidate serves cached data instantly while refreshing in background
const cacheControl = (maxAge: number, swr = 3600) => {
  return (_req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    res.setHeader("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${swr}`)
    next()
  }
}

export default defineMiddlewares({
  routes: [
    // QuickBooks webhook — preserve raw body for HMAC signature verification
    {
      matcher: "/webhooks/quickbooks",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
    // Admin variant supplier routes - allow custom body fields
    {
      matcher: "/admin/variants/:variant_id/suppliers",
      method: ["POST"],
      additionalDataValidator: {},
    },
    {
      matcher: "/admin/variants/:variant_id/suppliers/:supplier_id",
      method: ["PATCH"],
      additionalDataValidator: {},
    },
    {
      matcher: "/admin/products/:product_id/variants/suppliers",
      method: ["POST"],
      additionalDataValidator: {},
    },
    // Search — tightest limit, primary scraper target
    {
      matcher: "/store/products/search",
      method: ["GET"],
      middlewares: [wrap(searchLimiter)],
    },
    // VIN decode — external API dependency
    {
      matcher: "/store/vehicles/vin/*",
      method: ["GET"],
      middlewares: [wrap(vinDecodeLimiter)],
    },
    // Vehicle lookups (makes, models, years, resolve, fitment-filters)
    // Cache 5 min — this data rarely changes
    {
      matcher: "/store/vehicles/*",
      method: ["GET"],
      middlewares: [cacheControl(300), wrap(vehicleLimiter)],
    },
    {
      matcher: "/store/fitment-filters",
      method: ["GET"],
      middlewares: [cacheControl(300), wrap(vehicleLimiter)],
    },
    // Brands list — cache 5 min
    {
      matcher: "/store/brands",
      method: ["GET"],
      middlewares: [cacheControl(300)],
    },
    // Contact form — very tight limit
    {
      matcher: "/store/contact",
      method: ["POST"],
      middlewares: [wrap(contactLimiter)],
    },
    // Wholesale registration — handle multipart file uploads
    {
      matcher: "/store/customers/register-wholesale",
      method: ["POST"],
      middlewares: [wrap(upload.array("files")), wrap(contactLimiter)],
    },
    // Review submission
    {
      matcher: "/store/reviews",
      method: ["POST"],
      middlewares: [wrap(reviewLimiter)],
    },
    // Quote creation and add-to-cart
    {
      matcher: "/store/quotes",
      method: ["POST"],
      middlewares: [wrap(quoteLimiter)],
    },
    {
      matcher: "/store/quotes/*/add-to-cart",
      method: ["POST"],
      middlewares: [wrap(quoteLimiter)],
    },
    // Product categories — cache 5 min (rarely changes)
    {
      matcher: "/store/product-categories",
      method: ["GET"],
      middlewares: [cacheControl(300)],
    },
    // General store routes — catch-all
    {
      matcher: "/store/*",
      middlewares: [wrap(storeGeneralLimiter)],
    },
  ],
})
