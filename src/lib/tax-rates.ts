import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const CSV_URL =
  "https://raw.githubusercontent.com/MirzaAreebBaig/Woocommerce-US-ZipCodes-TaxRates/main/tax_rates.csv"

/**
 * Resolve project root — in production Medusa runs from .medusa/server/,
 * so process.cwd() won't be the project root. Walk up to find package.json.
 */
function getProjectRoot(): string {
  let dir = process.cwd()
  // If we're inside .medusa/server, go up two levels
  if (dir.includes(path.join(".medusa", "server"))) {
    dir = path.resolve(dir, "..", "..")
  }
  return dir
}

const PROJECT_ROOT = getProjectRoot()
const DATA_DIR = path.join(PROJECT_ROOT, "data")
const CSV_PATH = path.join(DATA_DIR, "tax-rates.csv")

// Retry cooldown: don't re-attempt download more than once per 5 minutes
const RETRY_COOLDOWN_MS = 5 * 60 * 1000

type ZipTaxEntry = {
  stateCode: string
  rate: number
}

// In-memory maps
const zipRates = new Map<string, ZipTaxEntry>()
const stateAverages = new Map<string, number>()

let loaded = false
let loadPromise: Promise<void> | null = null
let lastFailureTime = 0

/**
 * Pad a ZIP string to 5 digits with leading zeros.
 * The source CSV stores some ZIPs without leading zeros (e.g., "6001" for "06001").
 */
function padZip(zip: string): string {
  return zip.padStart(5, "0")
}

/**
 * Parse the WooCommerce-format CSV into the in-memory maps.
 * Format: Country code,State code,Postcode / ZIP,City,Rate %,Tax name,...
 */
function parseCSV(csvContent: string): void {
  zipRates.clear()
  stateAverages.clear()

  const lines = csvContent.split("\n")
  // Skip header line
  const stateRates = new Map<string, number[]>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const parts = line.split(",")
    if (parts.length < 5) continue

    const countryCode = parts[0].trim()
    const stateCode = parts[1].trim()
    const rawZip = parts[2].trim()
    const rate = parseFloat(parts[4].trim())

    if (countryCode !== "US" || !rawZip || isNaN(rate)) continue

    const zip = padZip(rawZip)
    zipRates.set(zip, { stateCode, rate })

    // Accumulate for state averages
    if (!stateRates.has(stateCode)) {
      stateRates.set(stateCode, [])
    }
    stateRates.get(stateCode)!.push(rate)
  }

  // Calculate state averages
  for (const [state, rates] of stateRates) {
    const sum = rates.reduce((a, b) => a + b, 0)
    stateAverages.set(state, Math.round((sum / rates.length) * 10000) / 10000)
  }
}

/**
 * Download the CSV from GitHub and write atomically to data/tax-rates.csv.
 */
export async function downloadCSV(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true })

  const response = await fetch(CSV_URL)
  if (!response.ok) {
    throw new Error(`Failed to download tax CSV: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()

  // Atomic write: write to temp file then rename
  const tmpPath = path.join(os.tmpdir(), `tax-rates-${Date.now()}.csv`)
  fs.writeFileSync(tmpPath, text, "utf-8")
  fs.renameSync(tmpPath, CSV_PATH)
}

/**
 * Load and parse the CSV file into memory.
 * Does NOT auto-download — the CSV must be pre-downloaded via the setup
 * script or weekly job. This keeps the checkout path free of external deps.
 */
async function loadTaxRates(): Promise<void> {
  if (loaded) return
  if (loadPromise) return loadPromise

  // Cooldown: don't retry too frequently after a failure
  const now = Date.now()
  if (lastFailureTime && now - lastFailureTime < RETRY_COOLDOWN_MS) {
    return
  }

  loadPromise = (async () => {
    try {
      if (!fs.existsSync(CSV_PATH)) {
        console.error(
          `[tax-rates] CSV not found at ${CSV_PATH}. ` +
            `Run: npx medusa exec src/scripts/download-tax-csv.ts`
        )
        lastFailureTime = Date.now()
        loadPromise = null
        return
      }

      const content = fs.readFileSync(CSV_PATH, "utf-8")
      parseCSV(content)

      if (zipRates.size === 0) {
        console.error("[tax-rates] CSV parsed but contained 0 ZIP entries — file may be corrupt")
        lastFailureTime = Date.now()
        loadPromise = null
        return
      }

      console.log(
        `[tax-rates] Loaded ${zipRates.size} ZIP codes, ${stateAverages.size} state averages`
      )
      loaded = true
    } catch (error) {
      console.error("[tax-rates] Failed to load tax rates:", error)
      lastFailureTime = Date.now()
      loadPromise = null
      // Don't set loaded = true — allow retries after cooldown
    }
  })()

  return loadPromise
}

/**
 * Reload tax rates from the CSV file (after a fresh download).
 */
export async function reloadTaxRates(): Promise<void> {
  loaded = false
  loadPromise = null
  lastFailureTime = 0
  await loadTaxRates()
}

/**
 * Get the combined tax rate for a US ZIP code.
 *
 * Fallback chain:
 * 1. Exact ZIP match → combined rate
 * 2. State average (from all ZIPs in that state)
 * 3. null (no data, or ZIP/state not found — caller falls back to region rates)
 *
 * @returns { rate, stateCode, source } or null if tax data is unavailable
 */
export async function getTaxRateForZip(
  zip: string,
  stateCode?: string | null
): Promise<{ rate: number; stateCode: string | null; source: string } | null> {
  await loadTaxRates()

  // If data never loaded, return null so caller can fall back to region rates
  if (zipRates.size === 0) {
    return null
  }

  // Normalize: strip whitespace, take first 5 chars, pad with leading zeros
  const normalizedZip = padZip(zip.replace(/[^0-9]/g, "").slice(0, 5))

  // 1. Exact ZIP match
  const entry = zipRates.get(normalizedZip)
  if (entry) {
    return { rate: entry.rate, stateCode: entry.stateCode, source: "zip" }
  }

  // 2. State average fallback
  const state = stateCode?.toUpperCase() || null
  if (state) {
    const avg = stateAverages.get(state)
    if (avg !== undefined) {
      return { rate: avg, stateCode: state, source: "state-avg" }
    }
  }

  // 3. No match — fall back to region rates
  return null
}

/**
 * Get the number of loaded ZIP codes (for diagnostics).
 */
export async function getTaxRateStats(): Promise<{
  zipCount: number
  stateCount: number
  csvExists: boolean
}> {
  await loadTaxRates()
  return {
    zipCount: zipRates.size,
    stateCount: stateAverages.size,
    csvExists: fs.existsSync(CSV_PATH),
  }
}
