# Product Import Pipeline

Checklist for importing products (PartsLink, KSI, or any other source).

## Post-Import Requirements

After importing products, the import script MUST:

1. **Create a $0 price set for all quote-only variants** — Medusa's cart/checkout workflow requires every variant to have a price set, even if the actual price comes from a quote. Without this, "continue to delivery" will fail with "Variants with IDs ... do not have a price".

2. **Create an inventory item for every variant** — All variants need an inventory item linked, regardless of whether inventory is tracked. Without this, fulfillment and stock location logic breaks.
