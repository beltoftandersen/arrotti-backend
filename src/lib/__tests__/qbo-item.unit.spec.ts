import { upsertInventoryItemByName, resolveShippingItem } from "../qbo-item"
import { QboHttpError } from "../qbo-retry"
import type { QboClient } from "../qbo-client"

type QueuedResponse = unknown | Error

class FakeQboClient {
  public queries: string[] = []
  public posts: Array<{ endpoint: string; body: any }> = []

  constructor(
    private queryResponses: QueuedResponse[] = [],
    private postResponses: QueuedResponse[] = []
  ) {}

  async query<T>(q: string): Promise<T> {
    this.queries.push(q)
    const next = this.queryResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }

  async post<T>(endpoint: string, body: any): Promise<T> {
    this.posts.push({ endpoint, body })
    const next = this.postResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }

  get(): never {
    throw new Error("get not used by qbo-item")
  }
}

const asClient = (fake: FakeQboClient) => fake as unknown as QboClient

const accounts = {
  income: { value: "100", name: "B2B Website Sales" },
  cogs: { value: "200", name: "Cost of goods sold" },
  asset: { value: "300", name: "Inventory" },
}

const shippingIncome = { value: "150", name: "Shipping Income" }

describe("upsertInventoryItemByName", () => {
  it("creates a new Inventory item with all required fields when Name is unused", async () => {
    const fake = new FakeQboClient(
      [{ QueryResponse: {} }],
      [{ Item: { Id: "42", Name: "WIDGET-1", SyncToken: "0" } }]
    )

    const ref = await upsertInventoryItemByName(asClient(fake), {
      name: "WIDGET-1",
      sku: "WIDGET-1",
      description: "A widget",
      unitPrice: 19.99,
      invStartDate: "2026-04-15",
      accounts,
    })

    expect(ref).toEqual({ value: "42", name: "WIDGET-1" })
    expect(fake.queries).toHaveLength(1)
    expect(fake.queries[0]).toContain("FROM Item WHERE Name = 'WIDGET-1'")
    expect(fake.posts).toHaveLength(1)

    const body = fake.posts[0].body
    expect(fake.posts[0].endpoint).toBe("item")
    expect(body.Type).toBe("Inventory")
    expect(body.Name).toBe("WIDGET-1")
    expect(body.Sku).toBe("WIDGET-1")
    expect(body.Description).toBe("A widget")
    expect(body.UnitPrice).toBe(19.99)
    expect(body.PurchaseCost).toBe(0)
    expect(body.TrackQtyOnHand).toBe(true)
    expect(body.QtyOnHand).toBe(0)
    expect(body.InvStartDate).toBe("2026-04-15")
    expect(body.Active).toBe(true)
    expect(body.IncomeAccountRef).toEqual(accounts.income)
    expect(body.ExpenseAccountRef).toEqual(accounts.cogs)
    expect(body.AssetAccountRef).toEqual(accounts.asset)
    expect(body.Id).toBeUndefined()
    expect(body.SyncToken).toBeUndefined()
    expect(body.sparse).toBeUndefined()
  })

  it("sparse-updates an existing item without changing Type or account refs", async () => {
    const existing = {
      Id: "42",
      Name: "WIDGET-1",
      Sku: "WIDGET-1",
      Type: "Inventory",
      SyncToken: "3",
      UnitPrice: 19.99,
    }
    const fake = new FakeQboClient(
      [{ QueryResponse: { Item: [existing] } }],
      [{ Item: { Id: "42", Name: "WIDGET-1", SyncToken: "4" } }]
    )

    await upsertInventoryItemByName(asClient(fake), {
      name: "WIDGET-1",
      sku: "WIDGET-1",
      description: "Updated description",
      unitPrice: 24.99,
      invStartDate: "2026-04-15",
      accounts,
    })

    expect(fake.posts).toHaveLength(1)
    const body = fake.posts[0].body
    expect(body.Id).toBe("42")
    expect(body.SyncToken).toBe("3")
    expect(body.sparse).toBe(true)
    expect(body.Name).toBe("WIDGET-1")
    expect(body.Sku).toBe("WIDGET-1")
    expect(body.Description).toBe("Updated description")
    expect(body.UnitPrice).toBe(24.99)
    expect(body.Type).toBeUndefined()
    expect(body.IncomeAccountRef).toBeUndefined()
    expect(body.ExpenseAccountRef).toBeUndefined()
    expect(body.AssetAccountRef).toBeUndefined()
    expect(body.TrackQtyOnHand).toBeUndefined()
  })

  it("retries with a fresh SyncToken when the first update fails as stale", async () => {
    const staleErr = new QboHttpError(400, "Stale Object Error: 5010", "item")
    const existingV1 = { Id: "42", Name: "WIDGET-1", SyncToken: "3" }
    const existingV2 = { Id: "42", Name: "WIDGET-1", SyncToken: "4" }

    const fake = new FakeQboClient(
      [
        { QueryResponse: { Item: [existingV1] } },
        { QueryResponse: { Item: [existingV2] } },
      ],
      [staleErr, { Item: { Id: "42", Name: "WIDGET-1", SyncToken: "5" } }]
    )

    await upsertInventoryItemByName(asClient(fake), {
      name: "WIDGET-1",
      sku: "WIDGET-1",
      invStartDate: "2026-04-15",
      accounts,
    })

    expect(fake.queries).toHaveLength(2)
    expect(fake.posts).toHaveLength(2)
    expect(fake.posts[0].body.SyncToken).toBe("3")
    expect(fake.posts[1].body.SyncToken).toBe("4")
  })

  it("recovers from a duplicate-Name race by falling through to sparse update", async () => {
    const dupeErr = new QboHttpError(400, "Duplicate Name Exists Error: 6240", "item")
    const fake = new FakeQboClient(
      [
        { QueryResponse: {} },
        { QueryResponse: { Item: [{ Id: "99", Name: "WIDGET-1", SyncToken: "0" }] } },
      ],
      [dupeErr, { Item: { Id: "99", Name: "WIDGET-1", SyncToken: "1" } }]
    )

    const ref = await upsertInventoryItemByName(asClient(fake), {
      name: "WIDGET-1",
      sku: "WIDGET-1",
      invStartDate: "2026-04-15",
      accounts,
    })

    expect(ref).toEqual({ value: "99", name: "WIDGET-1" })
    expect(fake.queries).toHaveLength(2)
    expect(fake.posts).toHaveLength(2)
    expect(fake.posts[0].body.Type).toBe("Inventory")
    expect(fake.posts[1].body.sparse).toBe(true)
    expect(fake.posts[1].body.Id).toBe("99")
  })

  it("escapes single quotes in the Name query", async () => {
    const fake = new FakeQboClient(
      [{ QueryResponse: {} }],
      [{ Item: { Id: "1", Name: "SKU'QUOTE", SyncToken: "0" } }]
    )

    await upsertInventoryItemByName(asClient(fake), {
      name: "SKU'QUOTE",
      sku: "SKU'QUOTE",
      invStartDate: "2026-04-15",
      accounts,
    })

    expect(fake.queries[0]).toContain("'SKU\\'QUOTE'")
  })

  it("rethrows non-retryable HTTP errors immediately", async () => {
    const fatal = new QboHttpError(500, "Internal server error", "item")
    const fake = new FakeQboClient([{ QueryResponse: {} }], [fatal])

    await expect(
      upsertInventoryItemByName(asClient(fake), {
        name: "WIDGET-1",
        sku: "WIDGET-1",
        invStartDate: "2026-04-15",
        accounts,
      })
    ).rejects.toBe(fatal)

    expect(fake.posts).toHaveLength(1)
  })
})

describe("resolveShippingItem", () => {
  it("returns the existing Shipping item without creating a new one", async () => {
    const existing = { Id: "77", Name: "Shipping", Type: "Service", SyncToken: "0" }
    const fake = new FakeQboClient([{ QueryResponse: { Item: [existing] } }], [])

    const ref = await resolveShippingItem(asClient(fake), {
      name: "Shipping",
      shippingIncomeAccount: shippingIncome,
    })

    expect(ref).toEqual({ value: "77", name: "Shipping" })
    expect(fake.posts).toHaveLength(0)
  })

  it("creates a Service shipping item on the configured income account when missing", async () => {
    const fake = new FakeQboClient(
      [{ QueryResponse: {} }],
      [{ Item: { Id: "78", Name: "Shipping", SyncToken: "0" } }]
    )

    const ref = await resolveShippingItem(asClient(fake), {
      name: "Shipping",
      shippingIncomeAccount: shippingIncome,
    })

    expect(ref).toEqual({ value: "78", name: "Shipping" })
    expect(fake.posts).toHaveLength(1)
    const body = fake.posts[0].body
    expect(body.Name).toBe("Shipping")
    expect(body.Type).toBe("Service")
    expect(body.IncomeAccountRef).toEqual(shippingIncome)
    expect(body.Active).toBe(true)
    expect(body.TrackQtyOnHand).toBeUndefined()
    expect(body.AssetAccountRef).toBeUndefined()
    expect(body.ExpenseAccountRef).toBeUndefined()
  })
})
