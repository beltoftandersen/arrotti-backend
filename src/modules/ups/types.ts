// src/modules/ups/types.ts

// --- Configuration ---

export type UpsOptions = {
  client_id: string
  client_secret: string
  account_number: string
  base_url?: string
}

// --- OAuth ---

export type OAuthTokenResponse = {
  token_type: string
  issued_at: string
  client_id: string
  access_token: string
  expires_in: string // seconds as string
  status: string
}

// --- Common ---

export type UpsAddress = {
  AddressLine: string[]
  City: string
  StateProvinceCode: string
  PostalCode: string
  CountryCode: string
}

export type UpsWeight = {
  UnitOfMeasurement: {
    Code: "LBS" | "KGS"
    Description?: string
  }
  Weight: string // numeric string
}

export type UpsDimensions = {
  UnitOfMeasurement: {
    Code: "IN" | "CM"
    Description?: string
  }
  Length: string
  Width: string
  Height: string
}

export type UpsPackage = {
  PackagingType: {
    Code: string // "02" = Customer Supplied Package
    Description?: string
  }
  PackageWeight: UpsWeight
  Dimensions?: UpsDimensions
}

export type UpsService = {
  Code: string
  Description?: string
}

// --- Rating ---

export type RateRequest = {
  RateRequest: {
    Request: {
      SubVersion?: string
      TransactionReference?: {
        CustomerContext?: string
      }
    }
    Shipment: {
      Shipper: {
        Name?: string
        ShipperNumber: string
        Address: UpsAddress
      }
      ShipTo: {
        Name?: string
        Address: UpsAddress
      }
      ShipFrom: {
        Name?: string
        Address: UpsAddress
      }
      Service: UpsService
      Package: UpsPackage[]
    }
  }
}

export type RateResponseBody = {
  RateResponse: {
    Response: {
      ResponseStatus: {
        Code: string
        Description: string
      }
      Alert?: {
        Code: string
        Description: string
      }[]
    }
    RatedShipment: {
      Service: UpsService
      TotalCharges: {
        CurrencyCode: string
        MonetaryValue: string // numeric string e.g. "12.50"
      }
      TransportationCharges: {
        CurrencyCode: string
        MonetaryValue: string
      }
      ServiceOptionsCharges: {
        CurrencyCode: string
        MonetaryValue: string
      }
      NegotiatedRateCharges?: {
        TotalCharge: {
          CurrencyCode: string
          MonetaryValue: string
        }
      }
    }
  }
}

// --- Shipping ---

export type ShipmentRequest = {
  ShipmentRequest: {
    Request: {
      SubVersion?: string
      RequestOption: "nonvalidate" | "validate"
      TransactionReference?: {
        CustomerContext?: string
      }
    }
    Shipment: {
      Description?: string
      Shipper: {
        Name?: string
        ShipperNumber: string
        Address: UpsAddress
      }
      ShipTo: {
        Name?: string
        Phone?: {
          Number: string
        }
        Address: UpsAddress
      }
      ShipFrom: {
        Name?: string
        Address: UpsAddress
      }
      PaymentInformation: {
        ShipmentCharge: {
          Type: "01" // Transportation
          BillShipper: {
            AccountNumber: string
          }
        }[]
      }
      Service: UpsService
      Package: (UpsPackage & {
        Description?: string
      })[]
    }
    LabelSpecification: {
      LabelImageFormat: {
        Code: "GIF" | "PNG" | "ZPL"
      }
      LabelStockSize?: {
        Height: string
        Width: string
      }
    }
  }
}

export type ShipmentResponseBody = {
  ShipmentResponse: {
    Response: {
      ResponseStatus: {
        Code: string
        Description: string
      }
      Alert?: {
        Code: string
        Description: string
      }[]
    }
    ShipmentResults: {
      ShipmentCharges: {
        TotalCharges: {
          CurrencyCode: string
          MonetaryValue: string
        }
        TransportationCharges: {
          CurrencyCode: string
          MonetaryValue: string
        }
        ServiceOptionsCharges: {
          CurrencyCode: string
          MonetaryValue: string
        }
      }
      NegotiatedRateCharges?: {
        TotalCharge: {
          CurrencyCode: string
          MonetaryValue: string
        }
      }
      ShipmentIdentificationNumber: string
      PackageResults:
        | {
            TrackingNumber: string
            ShippingLabel: {
              ImageFormat: {
                Code: string
              }
              GraphicImage: string // base64 encoded
            }
          }
        | {
            TrackingNumber: string
            ShippingLabel: {
              ImageFormat: {
                Code: string
              }
              GraphicImage: string
            }
          }[]
    }
  }
}

// --- Void ---

export type VoidRequest = {
  trackingNumber: string
}

export type VoidResponseBody = {
  VoidShipmentResponse: {
    Response: {
      ResponseStatus: {
        Code: string
        Description: string
      }
    }
    SummaryResult: {
      Status: {
        Code: string
        Description: string
      }
    }
  }
}

// --- Error ---

export type UpsErrorResponse = {
  response?: {
    errors?: {
      code: string
      message: string
    }[]
  }
}

// --- Service Map ---

export const UPS_SERVICES: Record<string, string> = {
  "01": "UPS Next Day Air (Direct)",
  "02": "UPS 2nd Day Air (Direct)",
  "03": "UPS Ground (Direct)",
  "12": "UPS 3 Day Select (Direct)",
  "13": "UPS Next Day Air Saver (Direct)",
}

export const UPS_SERVICE_CODES = Object.keys(UPS_SERVICES)
