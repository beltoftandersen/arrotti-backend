/**
 * Import KSI product images: upload to S3 and link to products.
 *
 * Usage:
 *   npx ts-node src/scripts/import-ksi-images.ts [--limit N] [--dry-run]
 *
 * --limit N    Process only N products (default: all)
 * --dry-run    Show what would be done without uploading or inserting
 */
import * as fs from "fs"
import * as path from "path"
import * as csv from "csv-parse/sync"
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { createClient } from "@libsql/client"
import dotenv from "dotenv"
import { Pool } from "pg"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

// --- Config ---
const CSV_FILE = "/root/ksi_images/parts.csv"
const IMAGE_DIR = "/shared/backup/ksi_images"
const S3_PREFIX = "product-images"
const BATCH_SIZE = 100

const args = process.argv.slice(2)
const limitArg = args.indexOf("--limit")
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1]) : 0
const DRY_RUN = args.includes("--dry-run")

// --- S3 Client ---
const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
})
const S3_BUCKET = process.env.S3_BUCKET!
const S3_FILE_URL = process.env.S3_FILE_URL! // e.g. https://api-s3.arrottigroup.com/carparts

// --- Postgres ---
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  console.log("=== KSI Image Import ===")
  if (DRY_RUN) console.log("DRY RUN - no changes will be made\n")
  if (LIMIT) console.log(`LIMIT: ${LIMIT} products\n`)

  // 1. Read CSV and build partslink → image filename map (strip C suffix)
  const csvContent = fs.readFileSync(CSV_FILE, "utf-8")
  const rows: { part_number: string; image1: string }[] = csv.parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  })

  const imageMap = new Map<string, string>() // base_partslink → filename
  for (const row of rows) {
    const pn = row.part_number?.trim()
    const img = row.image1?.trim()
    if (!pn || !img) continue
    const base = pn.endsWith("C") ? pn.slice(0, -1) : pn
    if (!imageMap.has(base)) {
      imageMap.set(base, img)
    }
  }
  console.log(`CSV: ${imageMap.size} unique base parts with images`)

  // 2. Load product IDs by partslink_no
  const { rows: products } = await pool.query<{
    id: string
    partslink: string
    thumbnail: string | null
  }>(`
    SELECT id, metadata->>'partslink_no' as partslink, thumbnail
    FROM product
    WHERE deleted_at IS NULL
      AND metadata->>'partslink_no' IS NOT NULL
  `)
  console.log(`DB: ${products.length} products with partslink_no`)

  // 3. Match products to images
  type Match = {
    productId: string
    partslink: string
    filename: string
    hasThumbnail: boolean
  }
  const matches: Match[] = []
  for (const p of products) {
    const img = imageMap.get(p.partslink)
    if (img) {
      matches.push({
        productId: p.id,
        partslink: p.partslink,
        filename: img,
        hasThumbnail: !!p.thumbnail,
      })
    }
  }
  console.log(`Matched: ${matches.length} products to images`)
  console.log(
    `Already have thumbnail: ${matches.filter((m) => m.hasThumbnail).length}`
  )

  if (LIMIT && matches.length > LIMIT) {
    matches.length = LIMIT
    console.log(`Limited to ${LIMIT} products`)
  }

  if (DRY_RUN) {
    console.log("\nSample matches:")
    for (const m of matches.slice(0, 10)) {
      console.log(`  ${m.partslink} → ${m.filename} (product: ${m.productId})`)
    }
    await pool.end()
    return
  }

  // 4. Process in batches
  let uploaded = 0
  let skippedS3 = 0
  let inserted = 0
  let thumbnailsSet = 0
  let errors = 0

  for (let i = 0; i < matches.length; i += BATCH_SIZE) {
    const batch = matches.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(matches.length / BATCH_SIZE)
    console.log(
      `\nBatch ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, matches.length)})`
    )

    for (const match of batch) {
      try {
        const localPath = path.join(IMAGE_DIR, match.filename)
        if (!fs.existsSync(localPath)) {
          console.log(`  SKIP ${match.partslink}: file not found ${match.filename}`)
          errors++
          continue
        }

        // Determine content type
        const ext = path.extname(match.filename).toLowerCase()
        const contentType =
          ext === ".png"
            ? "image/png"
            : ext === ".gif"
              ? "image/gif"
              : "image/jpeg"

        // S3 key
        const s3Key = `${S3_PREFIX}/${match.partslink}${ext}`
        const publicUrl = `${S3_FILE_URL}/${s3Key}`

        // Check if already uploaded
        let alreadyExists = false
        try {
          await s3.send(
            new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key })
          )
          alreadyExists = true
          skippedS3++
        } catch {
          // Doesn't exist, upload it
        }

        if (!alreadyExists) {
          const fileBuffer = fs.readFileSync(localPath)
          await s3.send(
            new PutObjectCommand({
              Bucket: S3_BUCKET,
              Key: s3Key,
              Body: fileBuffer,
              ContentType: contentType,
              CacheControl: "public, max-age=31536000",
            })
          )
          uploaded++
        }

        // Insert image record (check if already exists)
        const { rowCount: existing } = await pool.query(
          `SELECT 1 FROM image WHERE product_id = $1 AND url = $2 AND deleted_at IS NULL`,
          [match.productId, publicUrl]
        )
        if (!existing) {
          await pool.query(
            `INSERT INTO image (id, url, product_id, rank, metadata, created_at, updated_at)
             VALUES (
               'img_' || substr(md5(random()::text), 1, 26),
               $1, $2, 0, '{}', NOW(), NOW()
             )`,
            [publicUrl, match.productId]
          )
          inserted++
        }

        // Set thumbnail if not already set
        if (!match.hasThumbnail) {
          await pool.query(
            `UPDATE product SET thumbnail = $1, updated_at = NOW() WHERE id = $2`,
            [publicUrl, match.productId]
          )
          thumbnailsSet++
        }
      } catch (err: any) {
        console.log(`  ERROR ${match.partslink}: ${err.message}`)
        errors++
      }
    }

    console.log(
      `  Progress: ${Math.min(i + BATCH_SIZE, matches.length)}/${matches.length} | ` +
        `S3: ${uploaded} uploaded, ${skippedS3} existed | ` +
        `DB: ${inserted} images, ${thumbnailsSet} thumbnails | ` +
        `Errors: ${errors}`
    )
  }

  console.log("\n=== Done ===")
  console.log(`Uploaded to S3: ${uploaded}`)
  console.log(`Already on S3: ${skippedS3}`)
  console.log(`Image records created: ${inserted}`)
  console.log(`Thumbnails set: ${thumbnailsSet}`)
  console.log(`Errors: ${errors}`)

  await pool.end()
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
