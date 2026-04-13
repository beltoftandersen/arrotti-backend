export const DEFAULT_MAX_WEIGHT_LB = 50
export const DEFAULT_MAX_LONGEST_IN = 48

export type PackInput = {
  variant_id?: string | null
  quantity: number
  weight: number | null
  length: number | null
  width: number | null
  height: number | null
}

export type Package = {
  weight: number
  length: number
  width: number
  height: number
  units: number
}

export type PackOptions = {
  maxWeightLb?: number
  maxLongestIn?: number
}

type Unit = {
  weight: number
  length: number
  width: number
  height: number
}

function expandToUnits(items: PackInput[]): Unit[] {
  const units: Unit[] = []
  for (const item of items) {
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0))
    const unit: Unit = {
      weight: Number(item.weight) || 0,
      length: Number(item.length) || 0,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
    }
    for (let i = 0; i < qty; i++) units.push(unit)
  }
  return units
}

function tryAdd(pkg: Package, unit: Unit, maxWeightLb: number, maxLongestIn: number): Package | null {
  const next: Package = {
    weight: pkg.weight + unit.weight,
    length: Math.max(pkg.length, unit.length),
    width: Math.max(pkg.width, unit.width),
    height: pkg.height + unit.height,
    units: pkg.units + 1,
  }
  if (next.weight > maxWeightLb) return null
  const longest = Math.max(next.length, next.width, next.height)
  if (longest > maxLongestIn) return null
  return next
}

/**
 * Resolves the effective caps, preferring explicit opts over env vars
 * over compiled-in defaults.
 */
export function resolveCaps(opts?: PackOptions): { maxWeightLb: number; maxLongestIn: number } {
  const envWeight = Number(process.env.PACKAGE_MAX_WEIGHT_LB)
  const envLongest = Number(process.env.PACKAGE_MAX_LONGEST_IN)
  return {
    maxWeightLb:
      opts?.maxWeightLb ??
      (Number.isFinite(envWeight) && envWeight > 0 ? envWeight : DEFAULT_MAX_WEIGHT_LB),
    maxLongestIn:
      opts?.maxLongestIn ??
      (Number.isFinite(envLongest) && envLongest > 0 ? envLongest : DEFAULT_MAX_LONGEST_IN),
  }
}

export function packCart(items: PackInput[], opts?: PackOptions): Package[] {
  const { maxWeightLb, maxLongestIn } = resolveCaps(opts)

  const units = expandToUnits(items)
  if (units.length === 0) return []

  // FFD: biggest-hardest-to-pack first. Tie-break fully so sort is deterministic.
  units.sort((a, b) => {
    const la = Math.max(a.length, a.width, a.height)
    const lb = Math.max(b.length, b.width, b.height)
    if (lb !== la) return lb - la
    if (b.weight !== a.weight) return b.weight - a.weight
    if (b.length !== a.length) return b.length - a.length
    if (b.width !== a.width) return b.width - a.width
    return b.height - a.height
  })

  const packages: Package[] = []
  for (const unit of units) {
    let placed = false
    for (let i = 0; i < packages.length; i++) {
      const next = tryAdd(packages[i], unit, maxWeightLb, maxLongestIn)
      if (next) {
        packages[i] = next
        placed = true
        break
      }
    }
    if (!placed) {
      packages.push({
        weight: unit.weight,
        length: unit.length,
        width: unit.width,
        height: unit.height,
        units: 1,
      })
    }
  }
  return packages
}
