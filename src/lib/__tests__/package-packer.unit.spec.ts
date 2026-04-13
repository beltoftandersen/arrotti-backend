import { packCart } from "../package-packer"

describe("packCart", () => {
  it("returns [] for an empty cart", () => {
    expect(packCart([])).toEqual([])
  })

  it("packs a single small unit into one package", () => {
    const result = packCart([
      { variant_id: "v1", quantity: 1, weight: 9, length: 57, width: 17, height: 10 },
    ])
    expect(result).toEqual([
      { weight: 9, length: 57, width: 17, height: 10, units: 1 },
    ])
  })

  it("combines two small units into one package under budget", () => {
    const result = packCart([
      { variant_id: "v1", quantity: 2, weight: 20, length: 20, width: 20, height: 10 },
    ])
    expect(result).toEqual([
      { weight: 40, length: 20, width: 20, height: 20, units: 2 },
    ])
  })

  it("splits into two packages when combined weight exceeds 50 lb", () => {
    const result = packCart([
      { variant_id: "v1", quantity: 2, weight: 30, length: 20, width: 20, height: 10 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].weight).toBe(30)
    expect(result[1].weight).toBe(30)
  })

  it("gives a single unit over the longest-side cap its own package", () => {
    const result = packCart([
      { variant_id: "v1", quantity: 1, weight: 10, length: 60, width: 10, height: 10 },
      { variant_id: "v2", quantity: 1, weight: 10, length: 60, width: 10, height: 10 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].length).toBe(60)
    expect(result[1].length).toBe(60)
  })

  it("packs biggest units first (FFD) for tighter bins", () => {
    // FFD sort order: b(45lb), a(10lb), c(10lb) -> pkg1: b(45); pkg2: a+c (20lb)
    const result = packCart([
      { variant_id: "a", quantity: 1, weight: 10, length: 10, width: 10, height: 10 },
      { variant_id: "b", quantity: 1, weight: 45, length: 10, width: 10, height: 10 },
      { variant_id: "c", quantity: 1, weight: 10, length: 10, width: 10, height: 10 },
    ])
    expect(result).toHaveLength(2)
    const heaviest = result.reduce((m, p) => (p.weight > m.weight ? p : m))
    expect(heaviest.weight).toBe(45)
  })

  it("respects a tighter maxWeightLb override", () => {
    const result = packCart(
      [
        { variant_id: "v1", quantity: 2, weight: 20, length: 10, width: 10, height: 10 },
      ],
      { maxWeightLb: 30 }
    )
    // Both units 20lb; budget 30lb -> each its own package.
    expect(result).toHaveLength(2)
  })

  it("respects a tighter maxLongestIn override", () => {
    // Stacking 2 units (h=10 each) -> height 20, longest 20 = cap -> still fits in ONE.
    const loose = packCart(
      [
        { variant_id: "v1", quantity: 2, weight: 10, length: 20, width: 10, height: 10 },
      ],
      { maxLongestIn: 20 }
    )
    // Tighten to 19 -> 20" length already exceeds cap for any single unit -> each its own.
    const strict = packCart(
      [
        { variant_id: "v1", quantity: 2, weight: 10, length: 20, width: 10, height: 10 },
      ],
      { maxLongestIn: 19 }
    )
    expect(loose).toHaveLength(1)
    expect(strict).toHaveLength(2)
  })
})
