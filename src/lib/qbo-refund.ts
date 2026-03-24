/**
 * QuickBooks Online Refund Operations
 *
 * In QuickBooks, refunds can be handled in several ways:
 * 1. Credit Memo - Credits the customer's account (can be applied to future invoices)
 * 2. Refund Receipt - Direct refund (money back to customer)
 *
 * For e-commerce refunds, we'll use Refund Receipt which represents
 * money being returned to the customer.
 */

import { QboClient } from "./qbo-client"

export type QboRefundReceiptLine = {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: "SalesItemLineDetail"
  SalesItemLineDetail: {
    ItemRef?: { value: string; name?: string }
    Qty?: number
    UnitPrice?: number
  }
}

export type QboRefundReceipt = {
  Id: string
  DocNumber?: string
  TxnDate: string
  CustomerRef: { value: string; name?: string }
  Line: QboRefundReceiptLine[]
  TotalAmt: number
  PrivateNote?: string
  CustomerMemo?: { value: string }
  PaymentMethodRef?: { value: string; name?: string }
  DepositToAccountRef?: { value: string; name?: string }
  SyncToken?: string
}

type QboRefundReceiptResponse = {
  RefundReceipt: QboRefundReceipt
}

export type RefundLineInput = {
  description: string
  quantity: number
  unitPrice: number
}

export type RefundInput = {
  customerId: string
  customerName?: string
  refundNumber?: string
  refundDate: string
  lines: RefundLineInput[]
  originalOrderNumber?: string
  reason?: string
  paymentMethod?: string
}

/**
 * Create a refund receipt in QuickBooks
 */
export async function createRefundReceipt(
  client: QboClient,
  input: RefundInput
): Promise<QboRefundReceipt> {
  const lines: QboRefundReceiptLine[] = input.lines.map((line, index) => ({
    LineNum: index + 1,
    Description: line.description,
    Amount: Math.round(line.quantity * line.unitPrice * 100) / 100,
    DetailType: "SalesItemLineDetail" as const,
    SalesItemLineDetail: {
      Qty: line.quantity,
      UnitPrice: line.unitPrice,
    },
  }))

  const refundData: Record<string, unknown> = {
    CustomerRef: {
      value: input.customerId,
      name: input.customerName,
    },
    TxnDate: input.refundDate.split("T")[0], // YYYY-MM-DD format
    Line: lines,
  }

  if (input.refundNumber) {
    refundData.DocNumber = input.refundNumber
  }

  // Build private note with order reference and reason
  const noteparts: string[] = []
  if (input.originalOrderNumber) {
    noteparts.push(`Original Order: ${input.originalOrderNumber}`)
  }
  if (input.reason) {
    noteparts.push(`Reason: ${input.reason}`)
  }
  if (noteparts.length > 0) {
    refundData.PrivateNote = noteparts.join(" | ")
  }

  const response = await client.post<QboRefundReceiptResponse>("refundreceipt", refundData)
  console.log(`[QBO] Created refund receipt (ID: ${response.RefundReceipt.Id})`)
  return response.RefundReceipt
}

/**
 * Create a simple refund for a full or partial amount
 * This is a convenience method for simple refund cases
 */
export async function createSimpleRefund(
  client: QboClient,
  customerId: string,
  customerName: string | undefined,
  amount: number,
  originalOrderNumber: string,
  reason?: string
): Promise<QboRefundReceipt> {
  return createRefundReceipt(client, {
    customerId,
    customerName,
    refundDate: new Date().toISOString(),
    lines: [
      {
        description: `Refund for Order ${originalOrderNumber}${reason ? ` - ${reason}` : ""}`,
        quantity: 1,
        unitPrice: amount,
      },
    ],
    originalOrderNumber,
    reason,
  })
}

/**
 * Get a refund receipt by ID
 */
export async function getRefundReceipt(
  client: QboClient,
  refundId: string
): Promise<QboRefundReceipt> {
  const response = await client.get<{ RefundReceipt: QboRefundReceipt }>(`refundreceipt/${refundId}`)
  return response.RefundReceipt
}

/**
 * Extract order number from refund receipt's private note
 * We store "Original Order: XXX" in the note when creating refunds
 */
export function extractOrderNumberFromRefund(refund: QboRefundReceipt): string | null {
  const note = refund.PrivateNote || ""
  const match = note.match(/Original Order:\s*(\S+)/)
  return match ? match[1] : null
}
