/**
 * QuickBooks Online Invoice Operations
 */

import { QboClient } from "./qbo-client"

export type QboInvoiceLine = {
  Id?: string
  LineNum?: number
  Description?: string
  Amount: number
  DetailType: "SalesItemLineDetail"
  SalesItemLineDetail: {
    ItemRef?: { value: string; name?: string }
    Qty?: number
    UnitPrice?: number
    ServiceDate?: string
  }
}

export type QboInvoice = {
  Id: string
  DocNumber?: string
  TxnDate: string
  DueDate?: string
  CustomerRef: { value: string; name?: string }
  Line: QboInvoiceLine[]
  TotalAmt: number
  Balance: number
  EmailStatus?: string
  BillEmail?: { Address: string }
  BillAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
    Country?: string
  }
  ShipAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
    Country?: string
  }
  PrivateNote?: string
  CustomerMemo?: { value: string }
  SyncToken?: string
}

type QboInvoiceResponse = {
  Invoice: QboInvoice
}

export type InvoiceLineInput = {
  description: string
  quantity: number
  unitPrice: number
  sku?: string
  /** Per-line ItemRef — overrides input.incomeItemRef for this line when set. */
  itemRef?: { value: string; name: string }
}

export type InvoiceInput = {
  customerId: string
  customerName?: string
  orderNumber: string
  orderDate: string
  email?: string
  lines: InvoiceLineInput[]
  shippingAmount?: number
  /** Description shown on the shipping invoice line — typically the chosen shipping option name(s). Falls back to "Shipping" if not provided. */
  shippingDescription?: string
  taxAmount?: number
  billingAddress?: {
    address_1?: string
    city?: string
    province?: string
    postal_code?: string
    country_code?: string
  }
  shippingAddress?: {
    address_1?: string
    city?: string
    province?: string
    postal_code?: string
    country_code?: string
  }
  note?: string
  /** Payment terms reference (e.g., { value: "3", name: "Net 30" }) */
  salesTermRef?: { value: string; name: string }
  /** Sales channel name (e.g., "B2B Wholesale", "Default Channel") */
  salesChannelName?: string
  /** Fallback QBO Item/Service used for any line without its own itemRef (and for shipping if shippingItemRef is not set). */
  incomeItemRef?: { value: string; name: string }
  /** Dedicated QBO Item for the Shipping line. Overrides incomeItemRef for shipping only. */
  shippingItemRef?: { value: string; name: string }
  /** Discount note to include in PrivateNote (e.g., "Discount: -$5.00") */
  discountNote?: string
  /** Explicit DocNumber — required when QBO's "Custom transaction numbers" setting is ON */
  docNumber?: string
}

/**
 * Compute the next numeric invoice DocNumber by inspecting recent QBO invoices.
 * Assumes existing DocNumbers are numeric (ignores any that aren't).
 * Starting seed if no numeric invoices exist: 1001.
 *
 * `offset` is added to the computed next number — used by the duplicate-retry
 * loop in qbo-invoice-creator to break ties when two concurrent creates
 * compute the same "next" number (each retry bumps the offset by one).
 */
export async function getNextInvoiceDocNumber(
  client: QboClient,
  offset = 0
): Promise<string> {
  const result = await client.query<{
    QueryResponse: { Invoice?: Array<{ DocNumber?: string }> }
  }>("SELECT DocNumber FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS 200")

  const numbers = (result.QueryResponse?.Invoice || [])
    .map((i) => i.DocNumber)
    .filter((n): n is string => !!n && /^\d+$/.test(n))
    .map((n) => parseInt(n, 10))

  const max = numbers.length > 0 ? Math.max(...numbers) : 1000
  return String(max + 1 + offset)
}

/**
 * Create an invoice in QuickBooks
 */
export async function createInvoice(
  client: QboClient,
  input: InvoiceInput
): Promise<QboInvoice> {
  const taxCodeRef = input.taxAmount && input.taxAmount > 0
    ? { value: "TAX" }
    : { value: "NON" }

  const lines: Record<string, unknown>[] = input.lines.map((line, index) => ({
    LineNum: index + 1,
    Description: line.description,
    Amount: Math.round(line.quantity * line.unitPrice * 100) / 100,
    DetailType: "SalesItemLineDetail" as const,
    SalesItemLineDetail: {
      ItemRef: line.itemRef ?? input.incomeItemRef,
      Qty: line.quantity,
      UnitPrice: line.unitPrice,
      TaxCodeRef: taxCodeRef,
    },
  }))

  // Add shipping as a line item if present
  if (input.shippingAmount && input.shippingAmount > 0) {
    lines.push({
      LineNum: lines.length + 1,
      Description: input.shippingDescription || "Shipping",
      Amount: input.shippingAmount,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: input.shippingItemRef ?? input.incomeItemRef,
        Qty: 1,
        UnitPrice: input.shippingAmount,
        TaxCodeRef: taxCodeRef,
      },
    })
  }

  const invoiceData: Record<string, unknown> = {
    CustomerRef: {
      value: input.customerId,
      name: input.customerName,
    },
    TxnDate: input.orderDate.split("T")[0],
    Line: lines,
    PrivateNote: `${input.salesChannelName || "Online"} Order: ${input.orderNumber}${input.discountNote ? ` | ${input.discountNote}` : ""}`,
    GlobalTaxCalculation: "TaxExcluded",
  }

  if (input.docNumber) {
    invoiceData.DocNumber = input.docNumber
  }

  // Add tax using QBO's native tax field (not as a line item)
  if (input.taxAmount && input.taxAmount > 0) {
    invoiceData.TxnTaxDetail = {
      TotalTax: input.taxAmount,
    }
  }

  if (input.email) {
    invoiceData.BillEmail = { Address: input.email }
  }

  if (input.billingAddress) {
    invoiceData.BillAddr = {
      Line1: input.billingAddress.address_1,
      City: input.billingAddress.city,
      CountrySubDivisionCode: input.billingAddress.province,
      PostalCode: input.billingAddress.postal_code,
      Country: input.billingAddress.country_code,
    }
  }

  if (input.shippingAddress) {
    invoiceData.ShipAddr = {
      Line1: input.shippingAddress.address_1,
      City: input.shippingAddress.city,
      CountrySubDivisionCode: input.shippingAddress.province,
      PostalCode: input.shippingAddress.postal_code,
      Country: input.shippingAddress.country_code,
    }
  }

  if (input.note) {
    invoiceData.CustomerMemo = { value: input.note }
  }

  // Add payment terms if provided
  if (input.salesTermRef) {
    invoiceData.SalesTermRef = input.salesTermRef
  }

  const response = await client.post<QboInvoiceResponse>("invoice", invoiceData)
  console.log(`[QBO] Created invoice ${response.Invoice.DocNumber} (ID: ${response.Invoice.Id})`)
  return response.Invoice
}

/**
 * Get an invoice by ID
 */
export async function getInvoice(
  client: QboClient,
  invoiceId: string
): Promise<QboInvoice> {
  const response = await client.get<QboInvoiceResponse>(`invoice/${invoiceId}`)
  return response.Invoice
}

/**
 * Delete an invoice in QuickBooks
 * Note: Only works on invoices that haven't been paid/partially paid.
 * For paid invoices, void first.
 */
export async function deleteInvoice(
  client: QboClient,
  invoiceId: string,
  syncToken: string
): Promise<void> {
  await client.post("invoice?operation=delete", {
    Id: invoiceId,
    SyncToken: syncToken,
  })
  console.log(`[QBO] Deleted invoice ${invoiceId}`)
}

/**
 * Void an invoice in QuickBooks (for invoices with payments)
 */
export async function voidInvoice(
  client: QboClient,
  invoiceId: string,
  syncToken: string
): Promise<void> {
  await client.post("invoice?operation=void", {
    Id: invoiceId,
    SyncToken: syncToken,
  })
  console.log(`[QBO] Voided invoice ${invoiceId}`)
}
