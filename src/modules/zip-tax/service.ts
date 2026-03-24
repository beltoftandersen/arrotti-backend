import {
  ITaxProvider,
  ItemTaxLineDTO,
  ShippingTaxLineDTO,
  ItemTaxCalculationLine,
  ShippingTaxCalculationLine,
  TaxCalculationContext,
  Logger,
} from "@medusajs/framework/types"
import { getTaxRateForZip } from "../../lib/tax-rates"

type InjectedDependencies = {
  logger: Logger
}

export default class ZipTaxProviderService implements ITaxProvider {
  static identifier = "zip-tax"

  protected logger_: Logger

  constructor({ logger }: InjectedDependencies) {
    this.logger_ = logger
  }

  getIdentifier(): string {
    return ZipTaxProviderService.identifier
  }

  /**
   * Pass through configured region rates (system provider behavior).
   * Used as fallback for non-US addresses, missing ZIP, or when CSV is unavailable.
   */
  private systemFallback(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[]
  ): (ItemTaxLineDTO | ShippingTaxLineDTO)[] {
    let taxLines: (ItemTaxLineDTO | ShippingTaxLineDTO)[] = itemLines.flatMap(
      (l) =>
        l.rates.map((r) => ({
          rate_id: r.id,
          rate: r.rate || 0,
          name: r.name,
          code: r.code,
          line_item_id: l.line_item.id,
          provider_id: this.getIdentifier(),
        }))
    )

    taxLines = taxLines.concat(
      shippingLines.flatMap((l) =>
        l.rates.map((r) => ({
          rate_id: r.id,
          rate: r.rate || 0,
          name: r.name,
          code: r.code,
          shipping_line_id: l.shipping_line.id,
          provider_id: this.getIdentifier(),
        }))
      )
    )

    return taxLines
  }

  async getTaxLines(
    itemLines: ItemTaxCalculationLine[],
    shippingLines: ShippingTaxCalculationLine[],
    context: TaxCalculationContext
  ): Promise<(ItemTaxLineDTO | ShippingTaxLineDTO)[]> {
    const countryCode = context.address?.country_code?.toLowerCase()
    const postalCode = context.address?.postal_code
    const provinceCode = context.address?.province_code

    // For non-US or missing ZIP: fall back to configured tax region rates
    if (countryCode !== "us" || !postalCode) {
      return this.systemFallback(itemLines, shippingLines)
    }

    // Look up the rate from our CSV data
    const result = await getTaxRateForZip(postalCode, provinceCode)

    // If CSV data is unavailable or ZIP not found, fall back to region rates
    if (!result) {
      this.logger_.debug(
        "[zip-tax] No ZIP rate available — falling back to configured region rates"
      )
      return this.systemFallback(itemLines, shippingLines)
    }

    const { rate, stateCode, source } = result
    const taxCode = stateCode ? `US-${stateCode}` : "US-TAX"
    const taxName = stateCode ? `${stateCode} Sales Tax` : "Sales Tax"

    const taxLines: (ItemTaxLineDTO | ShippingTaxLineDTO)[] = []

    // Apply ZIP-based rate only to taxable line items.
    // Medusa computes l.rates based on tax rules — empty rates = tax-exempt.
    for (const l of itemLines) {
      if (l.rates.length === 0) continue
      taxLines.push({
        rate,
        name: taxName,
        code: taxCode,
        line_item_id: l.line_item.id,
        provider_id: this.getIdentifier(),
      })
    }

    // Apply ZIP-based rate only to taxable shipping lines
    for (const l of shippingLines) {
      if (l.rates.length === 0) continue
      taxLines.push({
        rate,
        name: taxName,
        code: taxCode,
        shipping_line_id: l.shipping_line.id,
        provider_id: this.getIdentifier(),
      })
    }

    if (source !== "zip") {
      this.logger_.debug(
        `[zip-tax] Used ${source} fallback (rate: ${rate}%)`
      )
    }

    return taxLines
  }
}
