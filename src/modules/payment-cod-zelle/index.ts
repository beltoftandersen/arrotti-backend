import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import CodZellePaymentService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [CodZellePaymentService],
})
