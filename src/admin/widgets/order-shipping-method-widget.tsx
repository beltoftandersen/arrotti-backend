import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Badge, Text } from "@medusajs/ui"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"

const formatAmount = (amount: number | string | null | undefined, currency?: string): string => {
  const n = typeof amount === "string" ? parseFloat(amount) : amount
  if (n === null || n === undefined || Number.isNaN(n)) return ""
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
    }).format(n)
  } catch {
    return `$${Number(n).toFixed(2)}`
  }
}

const OrderShippingMethodWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const methods = (data.shipping_methods ?? []) as Array<{
    id: string
    name?: string
    amount?: number | string
    data?: Record<string, any> | null
  }>

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <Heading level="h2">Shipping Method</Heading>

        {methods.length === 0 ? (
          <Text className="text-ui-fg-subtle txt-small">No shipping method set</Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {methods.map((m) => {
              const name = m.name || "Unnamed method"
              const isPickup = /pickup/i.test(name)
              const isFreight = /freight|ltl/i.test(name)
              const color = isPickup ? "green" : isFreight ? "orange" : "blue"
              const amount = formatAmount(m.amount, data.currency_code)

              return (
                <div key={m.id} className="flex items-center justify-between gap-x-2">
                  <Badge color={color} size="small">
                    {name}
                  </Badge>
                  {amount && (
                    <Text className="text-ui-fg-muted txt-small">{amount}</Text>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderShippingMethodWidget
