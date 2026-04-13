import { packCart } from "../package-packer"

describe("packCart", () => {
  it("returns [] for an empty cart", () => {
    expect(packCart([])).toEqual([])
  })
})
