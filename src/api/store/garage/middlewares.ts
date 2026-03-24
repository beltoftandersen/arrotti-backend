import { authenticate } from "@medusajs/framework/http"

export const storeGarageRoutesMiddlewares = [
  {
    method: ["GET", "POST"],
    matcher: "/store/garage",
    middlewares: [authenticate("customer", ["session", "bearer"])],
  },
  {
    method: ["PATCH", "DELETE"],
    matcher: "/store/garage/:id",
    middlewares: [authenticate("customer", ["session", "bearer"])],
  },
  {
    method: ["POST"],
    matcher: "/store/garage/touch",
    middlewares: [authenticate("customer", ["session", "bearer"])],
  },
]
