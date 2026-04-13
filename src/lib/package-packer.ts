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

export function packCart(items: PackInput[], opts?: PackOptions): Package[] {
  const maxWeightLb = opts?.maxWeightLb ?? DEFAULT_MAX_WEIGHT_LB
  const maxLongestIn = opts?.maxLongestIn ?? DEFAULT_MAX_LONGEST_IN

  const units = expandToUnits(items)
  if (units.length === 0) return []

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
