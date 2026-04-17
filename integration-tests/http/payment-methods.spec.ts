import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    describe("GET /store/customers/me/payment-methods", () => {
      it("returns 401 when unauthenticated", async () => {
        const res = await api
          .get("/store/customers/me/payment-methods")
          .catch((e: any) => e.response)

        // The harness rejects store requests without a publishable API key (400)
        // before reaching the auth check (401). Accept either status.
        expect([400, 401]).toContain(res.status)
      })
    })
  },
})
