/**
 * Cash on Delivery / Zelle manual payment provider.
 *
 * Mirrors Medusa's built-in SystemPaymentProvider
 * (node_modules/@medusajs/payment/dist/providers/system.js) so the offline
 * flow — immediate authorize, no external API calls, capture/refund as
 * bookkeeping — is identical to the "Check" provider. Only the identifier
 * differs so the admin + storefront can distinguish the two.
 */

import crypto from "crypto"
import {
  AbstractPaymentProvider,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CreateAccountHolderInput,
  CreateAccountHolderOutput,
  DeleteAccountHolderInput,
  DeleteAccountHolderOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrieveAccountHolderInput,
  RetrieveAccountHolderOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"

class CodZellePaymentService extends AbstractPaymentProvider {
  static identifier = "cod-zelle"

  constructor(container: any, options?: Record<string, unknown>) {
    super(container, options)
  }

  async getStatus(_: any): Promise<string> {
    return "authorized"
  }

  async getPaymentData(_: any): Promise<Record<string, unknown>> {
    return {}
  }

  async initiatePayment(_: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    return { data: {}, id: crypto.randomUUID() }
  }

  async getPaymentStatus(_: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    throw new Error("Method not implemented.")
  }

  async retrievePayment(_: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return {}
  }

  async authorizePayment(_: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return { data: {}, status: PaymentSessionStatus.AUTHORIZED }
  }

  async updatePayment(_: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: {} }
  }

  async deletePayment(_: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async capturePayment(_: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: {} }
  }

  async retrieveAccountHolder(
    input: RetrieveAccountHolderInput
  ): Promise<RetrieveAccountHolderOutput> {
    return { id: (input as any).id }
  }

  async createAccountHolder(
    input: CreateAccountHolderInput
  ): Promise<CreateAccountHolderOutput> {
    return { id: (input as any).context?.customer?.id }
  }

  async deleteAccountHolder(
    _: DeleteAccountHolderInput
  ): Promise<DeleteAccountHolderOutput> {
    return { data: {} }
  }

  async refundPayment(_: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { data: {} }
  }

  async cancelPayment(_: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: {} }
  }

  async getWebhookActionAndData(
    _: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default CodZellePaymentService
