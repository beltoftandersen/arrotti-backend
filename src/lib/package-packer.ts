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

export function packCart(items: PackInput[], _opts?: PackOptions): Package[] {
  const units = expandToUnits(items)
  if (units.length === 0) return []

  const packages: Package[] = []
  for (const unit of units) {
    packages.push({
      weight: unit.weight,
      length: unit.length,
      width: unit.width,
      height: unit.height,
      units: 1,
    })
  }
  return packages
}
