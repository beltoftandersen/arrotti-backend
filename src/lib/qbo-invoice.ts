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

type QboQueryResponse = {
  QueryResponse: {
    Invoice?: QboInvoice[]
    maxResults?: number
  }
}

export type InvoiceLineInput = {
  description: string
  quantity: number
  unitPrice: number
  sku?: string
}

export type InvoiceInput = {
  customerId: string
  customerName?: string
  orderNumber: string
  orderDate: string
  email?: string
  lines: InvoiceLineInput[]
  shippingAmount?: number
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
  /** QBO Item/Service to use for line items (maps to income account) */
  incomeItemRef?: { value: string; name: string }
  /** Discount note to include in PrivateNote (e.g., "Discount: -$5.00") */
  discountNote?: string
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
    Description: line.sku ? `[${line.sku}] ${line.description}` : line.description,
    Amount: Math.round(line.quantity * line.unitPrice * 100) / 100,
    DetailType: "SalesItemLineDetail" as const,
    SalesItemLineDetail: {
      ItemRef: input.incomeItemRef,
      Qty: line.quantity,
      UnitPrice: line.unitPrice,
      TaxCodeRef: taxCodeRef,
    },
  }))

  // Add shipping as a line item if present
  if (input.shippingAmount && input.shippingAmount > 0) {
    lines.push({
      LineNum: lines.length + 1,
      Description: "Shipping",
      Amount: input.shippingAmount,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: input.incomeItemRef,
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
    DocNumber: input.orderNumber,
    GlobalTaxCalculation: "TaxExcluded",
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
 * Find an invoice by order number (DocNumber)
 */
export async function findInvoiceByOrderNumber(
  client: QboClient,
  orderNumber: string
): Promise<QboInvoice | null> {
  const query = `SELECT * FROM Invoice WHERE DocNumber = '${orderNumber.replace(/'/g, "\\'")}'`

  const response = await client.query<QboQueryResponse>(query)

  if (response.QueryResponse.Invoice && response.QueryResponse.Invoice.length > 0) {
    return response.QueryResponse.Invoice[0]
  }

  return null
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
