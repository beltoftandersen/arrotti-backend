/**
 * QuickBooks Online Payment Operations
 */

import { QboClient } from "./qbo-client"

export type QboPaymentLine = {
  Amount: number
  LinkedTxn: Array<{
    TxnId: string
    TxnType: "Invoice"
  }>
}

export type QboPayment = {
  Id: string
  TxnDate: string
  CustomerRef: { value: string; name?: string }
  TotalAmt: number
  Line: QboPaymentLine[]
  PrivateNote?: string
  PaymentRefNum?: string
  PaymentMethodRef?: { value: string; name?: string }
  DepositToAccountRef?: { value: string; name?: string }
  SyncToken?: string
}

type QboPaymentResponse = {
  Payment: QboPayment
}

type QboQueryResponse = {
  QueryResponse: {
    Payment?: QboPayment[]
    PaymentMethod?: Array<{ Id: string; Name: string }>
    Account?: Array<{ Id: string; Name: string; AccountType: string }>
    maxResults?: number
  }
}

export type PaymentInput = {
  customerId: string
  customerName?: string
  invoiceId: string
  amount: number
  paymentDate: string
  paymentReference?: string
  paymentMethod?: string
  note?: string
  /** QBO Account to deposit payment to (e.g., "Checking") */
  depositAccountRef?: { value: string; name: string }
}

/**
 * Create a payment against an invoice in QuickBooks
 */
export async function createPayment(
  client: QboClient,
  input: PaymentInput
): Promise<QboPayment> {
  const paymentData: Record<string, unknown> = {
    CustomerRef: {
      value: input.customerId,
      name: input.customerName,
    },
    TotalAmt: input.amount,
    TxnDate: input.paymentDate.split("T")[0], // YYYY-MM-DD format
    Line: [
      {
        Amount: input.amount,
        LinkedTxn: [
          {
            TxnId: input.invoiceId,
            TxnType: "Invoice",
          },
        ],
      },
    ],
  }

  if (input.paymentReference) {
    // QBO PaymentRefNum has 21 char limit - truncate if needed
    paymentData.PaymentRefNum = input.paymentReference.slice(0, 21)
  }

  if (input.note) {
    paymentData.PrivateNote = input.note
  }

  // Try to find and use a matching payment method
  if (input.paymentMethod) {
    const methodRef = await findPaymentMethod(client, input.paymentMethod)
    if (methodRef) {
      paymentData.PaymentMethodRef = methodRef
      console.log(`[QBO] Using payment method: ${methodRef.name} (ID: ${methodRef.value})`)
    } else {
      console.warn(`[QBO] No payment method found for "${input.paymentMethod}", payment will have no method set`)
    }
  }

  // Set deposit account if provided
  if (input.depositAccountRef) {
    paymentData.DepositToAccountRef = input.depositAccountRef
    console.log(`[QBO] Using deposit account: ${input.depositAccountRef.name} (ID: ${input.depositAccountRef.value})`)
  }

  const response = await client.post<QboPaymentResponse>("payment", paymentData)
  console.log(`[QBO] Created payment (ID: ${response.Payment.Id}) for invoice ${input.invoiceId}`)
  return response.Payment
}

/**
 * Find a payment method by name (e.g., "Credit Card", "Cash", etc.)
 */
export async function findPaymentMethod(
  client: QboClient,
  name: string
): Promise<{ value: string; name: string } | null> {
  // Map common payment provider names to QBO payment methods
  // Includes Medusa v2 provider IDs (pp_stripe_stripe, pp_paypal_paypal, etc.)
  const methodMap: Record<string, string> = {
    stripe: "Credit Card",
    pp_stripe_stripe: "Credit Card",
    "credit card": "Credit Card",
    card: "Credit Card",
    paypal: "Credit Card",
    pp_paypal_paypal: "Credit Card",
    cash: "Cash",
    check: "Check",
    bank: "Check",
    pp_system_default: "Credit Card", // Manual/test payments
  }

  const searchName = methodMap[name.toLowerCase()] || name
  const escapedName = searchName.replace(/'/g, "\\'")

  try {
    // Try exact match first
    let query = `SELECT * FROM PaymentMethod WHERE Name = '${escapedName}'`
    let response = await client.query<QboQueryResponse>(query)

    if (response.QueryResponse.PaymentMethod && response.QueryResponse.PaymentMethod.length > 0) {
      const method = response.QueryResponse.PaymentMethod[0]
      console.log(`[QBO] Found payment method "${method.Name}" (ID: ${method.Id})`)
      return { value: method.Id, name: method.Name }
    }

    // Try case-insensitive LIKE as fallback
    query = `SELECT * FROM PaymentMethod WHERE Name LIKE '%${escapedName}%'`
    response = await client.query<QboQueryResponse>(query)

    if (response.QueryResponse.PaymentMethod && response.QueryResponse.PaymentMethod.length > 0) {
      const method = response.QueryResponse.PaymentMethod[0]
      console.log(`[QBO] Found payment method "${method.Name}" via LIKE (ID: ${method.Id})`)
      return { value: method.Id, name: method.Name }
    }

    console.warn(`[QBO] Payment method not found for "${name}" (searched: "${searchName}")`)
    return null
  } catch (e) {
    console.warn(`[QBO] Error finding payment method "${name}": ${(e as Error).message}`)
    return null
  }
}

/**
 * Find payments for a specific invoice
 */
export async function findPaymentsForInvoice(
  client: QboClient,
  invoiceId: string
): Promise<QboPayment[]> {
  // QBO doesn't support querying payments by linked invoice directly,
  // but we can get all payments for a customer and filter
  // For now, we'll just log and return empty - this is mainly for verification
  return []
}

/**
 * Get a payment by ID
 */
export async function getPayment(
  client: QboClient,
  paymentId: string
): Promise<QboPayment> {
  const response = await client.get<{ Payment: QboPayment }>(`payment/${paymentId}`)
  return response.Payment
}

/**
 * Extract invoice IDs from a payment's linked transactions
 */
export function getLinkedInvoiceIds(payment: QboPayment): string[] {
  const invoiceIds: string[] = []
  for (const line of payment.Line || []) {
    for (const txn of line.LinkedTxn || []) {
      if (txn.TxnType === "Invoice") {
        invoiceIds.push(txn.TxnId)
      }
    }
  }
  return invoiceIds
}

/**
 * Check if a payment already exists for an invoice in QBO
 * Uses invoice ID since PrivateNote is not queryable in QBO
 */
export async function paymentExistsForInvoice(
  client: QboClient,
  invoiceId: string
): Promise<boolean> {
  try {
    // Query all payments and check if any are linked to this invoice
    // Note: QBO doesn't support filtering by LinkedTxn directly, so we get recent payments
    // and check their linked invoices
    const query = `SELECT * FROM Payment ORDER BY TxnDate DESC MAXRESULTS 50`
    const response = await client.query<{ QueryResponse: { Payment?: QboPayment[] } }>(query)

    const payments = response.QueryResponse.Payment || []
    for (const payment of payments) {
      const linkedInvoices = getLinkedInvoiceIds(payment)
      if (linkedInvoices.includes(invoiceId)) {
        return true
      }
    }
    return false
  } catch (error) {
    // If query fails, err on the side of caution and allow the payment
    console.warn(`[QBO] Error checking for existing payment: ${(error as Error).message}`)
    return false
  }
}
