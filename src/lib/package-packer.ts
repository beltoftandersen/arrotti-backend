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

export function packCart(_items: PackInput[], _opts?: PackOptions): Package[] {
  return []
}
