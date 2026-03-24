/**
 * QuickBooks Online Customer Operations
 */

import { QboClient } from "./qbo-client"

export type QboCustomer = {
  Id: string
  DisplayName: string
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
    Country?: string
  }
  PrimaryPhone?: { FreeFormNumber: string }
  GivenName?: string
  FamilyName?: string
}

type QboQueryResponse = {
  QueryResponse: {
    Customer?: QboCustomer[]
    maxResults?: number
  }
}

type QboCustomerResponse = {
  Customer: QboCustomer
}

export type CustomerInput = {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  billingAddress?: {
    address_1?: string
    city?: string
    province?: string
    postal_code?: string
    country_code?: string
  }
}

/**
 * Find a customer in QuickBooks by email
 */
export async function findCustomerByEmail(
  client: QboClient,
  email: string
): Promise<QboCustomer | null> {
  const query = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email.replace(/'/g, "\\'")}'`

  const response = await client.query<QboQueryResponse>(query)

  if (response.QueryResponse.Customer && response.QueryResponse.Customer.length > 0) {
    return response.QueryResponse.Customer[0]
  }

  return null
}

/**
 * Create a new customer in QuickBooks
 */
export async function createCustomer(
  client: QboClient,
  input: CustomerInput
): Promise<QboCustomer> {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ")
  const displayName = fullName ? `${fullName} (${input.email})` : input.email

  const customerData: Record<string, unknown> = {
    DisplayName: displayName,
    PrimaryEmailAddr: { Address: input.email },
  }

  if (input.firstName) {
    customerData.GivenName = input.firstName
  }

  if (input.lastName) {
    customerData.FamilyName = input.lastName
  }

  if (input.phone) {
    customerData.PrimaryPhone = { FreeFormNumber: input.phone }
  }

  if (input.billingAddress) {
    customerData.BillAddr = {
      Line1: input.billingAddress.address_1,
      City: input.billingAddress.city,
      CountrySubDivisionCode: input.billingAddress.province,
      PostalCode: input.billingAddress.postal_code,
      Country: input.billingAddress.country_code,
    }
  }

  const response = await client.post<QboCustomerResponse>("customer", customerData)
  return response.Customer
}

/**
 * Find or create a customer in QuickBooks
 */
export async function findOrCreateCustomer(
  client: QboClient,
  input: CustomerInput
): Promise<QboCustomer> {
  // Try to find existing customer by email
  const existing = await findCustomerByEmail(client, input.email)
  if (existing) {
    console.log(`[QBO] Found existing customer: ${existing.DisplayName} (ID: ${existing.Id})`)
    return existing
  }

  // Create new customer
  const created = await createCustomer(client, input)
  console.log(`[QBO] Created new customer: ${created.DisplayName} (ID: ${created.Id})`)
  return created
}
