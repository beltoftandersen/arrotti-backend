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
  company?: string
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
 * Format a US phone to "(XXX) XXX-XXXX" to match the existing QBO DisplayName
 * convention. Returns undefined when the input isn't a 10-digit US number
 * (caller falls back to email-based uniqueness).
 */
function formatUsPhone(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length !== 10) return undefined
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
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
const upper = (s: string | undefined | null): string | undefined => {
  const t = (s ?? "").trim()
  return t.length > 0 ? t.toUpperCase() : undefined
}

export async function createCustomer(
  client: QboClient,
  input: CustomerInput
): Promise<QboCustomer> {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ")
  const companyUpper = upper(input.company)
  const formattedPhone = formatUsPhone(input.phone)

  // DisplayName convention mirrors existing QBO customers:
  //   "<COMPANY> (XXX) XXX-XXXX"     for B2B
  //   "First Last (XXX) XXX-XXXX"    for B2C with phone
  // Falls back to the prior "<name> (<email>)" form when we have no phone,
  // keeping uniqueness guaranteed.
  const base = companyUpper || fullName || input.email
  const displayName = formattedPhone
    ? `${base} ${formattedPhone}`
    : fullName
      ? `${fullName} (${input.email})`
      : input.email

  const customerData: Record<string, unknown> = {
    DisplayName: displayName,
    PrimaryEmailAddr: { Address: input.email },
  }

  if (companyUpper) {
    customerData.CompanyName = companyUpper
  }

  if (input.firstName) {
    customerData.GivenName = input.firstName
  }

  if (input.lastName) {
    customerData.FamilyName = input.lastName
  }

  if (input.phone) {
    customerData.PrimaryPhone = { FreeFormNumber: formattedPhone || input.phone }
  }

  if (input.billingAddress) {
    customerData.BillAddr = {
      Line1: companyUpper || upper(input.billingAddress.address_1),
      Line2: companyUpper ? upper(input.billingAddress.address_1) : undefined,
      City: upper(input.billingAddress.city),
      CountrySubDivisionCode: upper(input.billingAddress.province),
      PostalCode: input.billingAddress.postal_code,
      Country: upper(input.billingAddress.country_code),
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
