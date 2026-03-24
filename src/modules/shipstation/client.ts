import { MedusaError } from "@medusajs/framework/utils"
import { ShipStationOptions } from "./service"
import {
  CarriersResponse,
  GetShippingRatesRequest,
  GetShippingRatesResponse,
  Label,
  RateResponse,
  Shipment,
  VoidLabelResponse,
} from "./types"

const DEFAULT_BASE_URL = "https://api.shipstation.com/v2"
const REQUEST_TIMEOUT_MS = 30_000

export class ShipStationClient {
  protected options: ShipStationOptions
  protected baseUrl: string

  constructor(options: ShipStationOptions) {
    this.options = options
    this.baseUrl = options.base_url || DEFAULT_BASE_URL
  }

  private async sendRequest(url: string, data?: RequestInit): Promise<any> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let resp: Response
    try {
      resp = await fetch(`${this.baseUrl}${url}`, {
        ...data,
        signal: controller.signal,
        headers: {
          ...data?.headers,
          "api-key": this.options.api_key,
          "Content-Type": "application/json",
        },
      })
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `ShipStation request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (!resp.ok) {
      let errorDetail = `${resp.status} ${resp.statusText}`
      try {
        const body = await resp.json()
        if (body?.errors?.length) {
          errorDetail = body.errors.map((e: any) => e.message).join(", ")
        }
      } catch {
        // couldn't parse error body, use status text
      }
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `ShipStation API error (${resp.status}): ${errorDetail}`
      )
    }

    const contentType = resp.headers.get("content-type")
    if (!contentType?.includes("application/json")) {
      return resp.text()
    }

    const json = await resp.json()

    if (typeof json !== "string" && json.errors?.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `ShipStation error: ${json.errors.map((error: any) => error.message).join(", ")}`
      )
    }

    return json
  }

  async getCarriers(): Promise<CarriersResponse> {
    return await this.sendRequest("/carriers")
  }

  async getShippingRates(
    data: GetShippingRatesRequest
  ): Promise<GetShippingRatesResponse> {
    return await this.sendRequest("/rates", {
      method: "POST",
      body: JSON.stringify(data),
    }).then((resp) => {
      if (resp.rate_response.errors?.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `An error occurred while retrieving rates from ShipStation: ${resp.rate_response.errors.map((error: any) => error.message)}`
        )
      }

      return resp
    })
  }

  async getShipmentRates(id: string): Promise<RateResponse[]> {
    return await this.sendRequest(`/shipments/${id}/rates`)
  }

  async getShipment(id: string): Promise<Shipment> {
    return await this.sendRequest(`/shipments/${id}`)
  }

  async purchaseLabelForShipment(id: string): Promise<Label> {
    return await this.sendRequest(`/labels/shipment/${id}`, {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  async voidLabel(id: string): Promise<VoidLabelResponse> {
    return await this.sendRequest(`/labels/${id}/void`, {
      method: "PUT",
    })
  }

  async cancelShipment(id: string): Promise<void> {
    return await this.sendRequest(`/shipments/${id}/cancel`, {
      method: "PUT",
    })
  }
}
