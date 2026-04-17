import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { InformationCircleSolid } from "@medusajs/icons"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { isBlockedCaptureProvider } from "../../lib/blocked-capture-providers"

/**
 * Shows a warning banner on orders paid via Zelle / Cash / Check (or the
 * built-in manual provider). Staff can still see the Capture Payment button,
 * but the API middleware will reject it (see src/api/middlewares.ts).
 *
 * This widget pairs with the middleware to provide the "why" before the
 * "no" — giving staff context instead of a surprise error.
 */

function orderHasBlockedProvider(order: AdminOrder): boolean {
  const collections = (order as any).payment_collections || []
  for (const pc of collections) {
    for (const payment of pc.payments || []) {
      if (isBlockedCaptureProvider(payment.provider_id)) return true
    }
  }
  return false
}

const OrderExternalPaymentWidget = ({
  data,
}: DetailWidgetProps<AdminOrder>) => {
  if (!orderHasBlockedProvider(data)) return null

  return (
    <Container className="p-0 overflow-hidden border-l-4 border-l-ui-tag-orange-border">
      <div className="flex items-start gap-x-3 px-6 py-4">
        <InformationCircleSolid className="text-ui-tag-orange-icon shrink-0 mt-0.5" />
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">Paid via QuickBooks</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            This order was paid externally (Zelle / Cash / Check). Reconcile
            the invoice directly in QuickBooks. The Capture Payment button is
            blocked on this order — clicking it will return an error.
          </Text>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.before",
})

export default OrderExternalPaymentWidget
