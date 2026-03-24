import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

// DELETE /store/carts/:id/shipping-methods
// Removes all shipping methods from a cart (used when cart items change)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const cartService = req.scope.resolve(Modules.CART)

  try {
    const cart = await cartService.retrieveCart(id, {
      select: ["id"],
      relations: ["shipping_methods"],
    })

    if (!cart.shipping_methods?.length) {
      return res.json({ success: true, removed: 0 })
    }

    const ids = cart.shipping_methods.map((sm: any) => sm.id)
    await cartService.deleteShippingMethods(ids)

    return res.json({ success: true, removed: ids.length })
  } catch (error: any) {
    res.status(500).json({ message: error.message })
  }
}
