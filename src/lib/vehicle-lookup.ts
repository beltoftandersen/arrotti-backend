import { Pool } from "pg"

type VehicleInfo = {
  make: string
  model: string
  year_start: number
  year_end: number
}

// In-memory cache for vehicle data
const vehicleCache = new Map<string, VehicleInfo>()
let cacheLoaded = false
let cacheLoadPromise: Promise<void> | null = null

/**
 * Load all vehicles with make/model names into memory.
 * This is called once and cached for the lifetime of the process.
 */
async function loadVehicleCache(): Promise<void> {
  if (cacheLoaded) return
  if (cacheLoadPromise) return cacheLoadPromise

  cacheLoadPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      console.warn("[vehicle-lookup] DATABASE_URL not set, skipping cache load")
      cacheLoaded = true
      return
    }

    const pool = new Pool({ connectionString: databaseUrl })

    try {
      const result = await pool.query(`
        SELECT v.id, v.year_start, v.year_end, m.name as make_name, mo.name as model_name
        FROM vehicle v
        JOIN vehicle_make m ON v.make_id = m.id
        JOIN vehicle_model mo ON v.model_id = mo.id
      `)

      for (const row of result.rows) {
        vehicleCache.set(row.id, {
          make: row.make_name,
          model: row.model_name,
          year_start: row.year_start,
          year_end: row.year_end,
        })
      }

      console.log(`[vehicle-lookup] Loaded ${vehicleCache.size} vehicles into cache`)
      cacheLoaded = true
    } catch (error) {
      console.error("[vehicle-lookup] Failed to load vehicle cache:", error)
      cacheLoaded = true // Mark as loaded to prevent retries
    } finally {
      await pool.end()
    }
  })()

  return cacheLoadPromise
}

/**
 * Get vehicle info (make, model, year_start, year_end) for a vehicle ID.
 * Returns null if not found.
 */
export async function getVehicleInfo(vehicleId: string): Promise<VehicleInfo | null> {
  await loadVehicleCache()
  return vehicleCache.get(vehicleId) || null
}

/**
 * Get vehicle info for multiple vehicle IDs.
 * Returns a map of vehicleId -> VehicleInfo.
 */
export async function getVehicleInfoBatch(
  vehicleIds: string[]
): Promise<Map<string, VehicleInfo>> {
  await loadVehicleCache()

  const result = new Map<string, VehicleInfo>()
  for (const id of vehicleIds) {
    const info = vehicleCache.get(id)
    if (info) {
      result.set(id, info)
    }
  }
  return result
}

/**
 * Generate fitment_text array from vehicle IDs.
 * Expands year ranges into individual years so each year is a searchable token.
 * E.g., vehicle with year_start=2018, year_end=2021 produces:
 *   ["2018 Toyota Camry", "2019 Toyota Camry", "2020 Toyota Camry", "2021 Toyota Camry"]
 */
export async function generateFitmentText(vehicleIds: string[]): Promise<string[]> {
  const vehicleInfoMap = await getVehicleInfoBatch(vehicleIds)

  const fitmentText: string[] = []
  for (const id of vehicleIds) {
    const info = vehicleInfoMap.get(id)
    if (info) {
      for (let year = info.year_start; year <= info.year_end; year++) {
        fitmentText.push(`${year} ${info.make} ${info.model}`)
      }
    }
  }

  return [...new Set(fitmentText)] // Deduplicate
}

/**
 * Clear the cache (useful for testing or when vehicle data changes significantly)
 */
export function clearVehicleCache(): void {
  vehicleCache.clear()
  cacheLoaded = false
  cacheLoadPromise = null
}
