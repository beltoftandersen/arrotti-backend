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
})
