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

  it("produces identical output across repeated calls (determinism)", () => {
    const input = [
      { variant_id: "a", quantity: 3, weight: 7, length: 22, width: 16, height: 14 },
      { variant_id: "b", quantity: 6, weight: 11, length: 76, width: 12, height: 8 },
      { variant_id: "c", quantity: 1, weight: 9, length: 57, width: 17, height: 10 },
    ]
    const r1 = packCart(input)
    const r2 = packCart(input)
    expect(r2).toEqual(r1)
  })

  it("packs a real mixed cart within budget per package", () => {
    // Real cart that surfaced the bug:
    // 1 grille (TO1036204): 9lb, 57x17x10
    // 6 moldings (TO1224127): 11lb each, 76x12x8
    // 3 tanks (TO3014140): 7lb each, 22x16x14
    const result = packCart([
      { variant_id: "grille", quantity: 1, weight: 9, length: 57, width: 17, height: 10 },
      { variant_id: "molding", quantity: 6, weight: 11, length: 76, width: 12, height: 8 },
      { variant_id: "tank", quantity: 3, weight: 7, length: 22, width: 16, height: 14 },
    ])

    expect(result.length).toBeGreaterThan(1)

    for (const p of result) {
      // Weight cap applies to every package.
      expect(p.weight).toBeLessThanOrEqual(50)
      // Size cap applies only to multi-unit packages. Single oversized items
      // (like the 76" moldings or 57" grille) ship as their own oversized parcel
      // and retain their real dimensions so the carrier charges accordingly.
      if (p.units > 1) {
        expect(Math.max(p.length, p.width, p.height)).toBeLessThanOrEqual(48)
      }
    }

    // Total weight preserved: 9 + 66 + 21 = 96
    const totalWeight = result.reduce((s, p) => s + p.weight, 0)
    expect(totalWeight).toBe(96)

    // Total units preserved: 1 + 6 + 3 = 10
    const totalUnits = result.reduce((s, p) => s + p.units, 0)
    expect(totalUnits).toBe(10)
  })
})
