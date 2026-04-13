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
})
