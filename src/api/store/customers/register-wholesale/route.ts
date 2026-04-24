import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { formatUsPhone } from "../../../../lib/format-phone"

// Type for multer file
type MulterFile = {
  fieldname: string
  originalname: string
  encoding: string
  mimetype: string
  size: number
  buffer: Buffer
}

type TaxDocument = {
  filename: string
  url: string
  size: number
  uploaded_at: string
}

type RegisterWholesaleBody = {
  email: string
  password: string
  first_name: string
  last_name: string
  company_name?: string
  phone?: string
  tax_id?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
}

/**
 * POST /store/customers/register-wholesale
 *
 * Register a new wholesale customer with optional file uploads.
 * Files are expected as multipart/form-data with field name "files".
 * Other form fields contain customer data.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve("logger")

  try {
    // Extract form data (populated by multer middleware)
    const body = req.body as RegisterWholesaleBody
    const files = (req as any).files as MulterFile[] | undefined

    // Validate required fields
    if (!body.email || !body.password) {
      res.status(400).json({
        message: "Email and password are required",
      })
      return
    }

    if (!body.first_name || !body.last_name) {
      res.status(400).json({
        message: "First name and last name are required",
      })
      return
    }

    if (!body.company_name?.trim()) {
      res.status(400).json({ message: "Company name is required" })
      return
    }

    if (!body.tax_id?.trim()) {
      res.status(400).json({ message: "Tax ID is required" })
      return
    }

    const normalizedPhone = formatUsPhone(body.phone)
    if (!normalizedPhone) {
      res.status(400).json({
        message: "A valid US phone number is required (10 digits).",
      })
      return
    }

    const missingAddressField = !body.address_1?.trim()
      ? "street address"
      : !body.city?.trim()
        ? "city"
        : !body.province?.trim()
          ? "state"
          : !body.postal_code?.trim()
            ? "ZIP code"
            : null
    if (missingAddressField) {
      res.status(400).json({ message: `Billing ${missingAddressField} is required` })
      return
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      res.status(400).json({
        message: "Invalid email format",
      })
      return
    }

    // Validate password strength
    if (body.password.length < 8) {
      res.status(400).json({
        message: "Password must be at least 8 characters",
      })
      return
    }

    // 1. Upload tax documents if provided
    let taxDocuments: TaxDocument[] = []

    if (files && files.length > 0) {
      // Validate file count and sizes
      if (files.length > 5) {
        res.status(400).json({
          message: "Maximum 5 files allowed",
        })
        return
      }

      const maxFileSize = 10 * 1024 * 1024 // 10MB
      const allowedMimeTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
      ]

      for (const file of files) {
        if (file.size > maxFileSize) {
          res.status(400).json({
            message: `File ${file.originalname} exceeds 10MB limit`,
          })
          return
        }

        if (!allowedMimeTypes.includes(file.mimetype)) {
          res.status(400).json({
            message: `File ${file.originalname} has invalid type. Allowed: PDF, JPEG, PNG, WebP`,
          })
          return
        }
      }

      // Upload files using Medusa's file workflow
      const { result: uploadResult } = await uploadFilesWorkflow(req.scope).run({
        input: {
          files: files.map((f) => ({
            filename: f.originalname,
            mimeType: f.mimetype,
            content: f.buffer.toString("base64"),
            access: "private", // Tax documents should be private
          })),
        },
      })

      taxDocuments = uploadResult.map((uploaded, index) => ({
        filename: files[index].originalname,
        url: uploaded.url,
        size: files[index].size,
        uploaded_at: new Date().toISOString(),
      }))

      logger.info(`[Wholesale Registration] Uploaded ${taxDocuments.length} tax documents`)
    }

    // Normalize email and look up existing rows case-insensitively via
    // raw SQL — same semantics as the partial unique index
    // (LOWER(email) WHERE has_account = true AND deleted_at IS NULL).
    const emailLc = body.email.trim().toLowerCase()

    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const { rows: existingRows } = await db.raw(
      `SELECT id, email, has_account, first_name, last_name,
              company_name, phone, metadata, created_at
         FROM customer
        WHERE LOWER(email) = ? AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [emailLc]
    )

    const registeredRow = existingRows.find((r: any) => r.has_account === true)

    // Reapply branch: an existing registered customer that was previously
    // rejected may submit a new application. Anything else (approved, or
    // pending with no rejection) still 409s.
    const registeredMetadata =
      (registeredRow?.metadata as Record<string, any> | null) || null
    const isReapply =
      !!registeredRow &&
      !!registeredMetadata?.rejected_at &&
      !registeredMetadata?.approved_at

    if (registeredRow && !isReapply) {
      res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
      })
      return
    }

    const guestRow = existingRows.find((r: any) => r.has_account === false)

    const authModule = req.scope.resolve(Modules.AUTH)

    let customerResult: {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      company_name: string | null
    }

    if (isReapply && registeredRow) {
      // Find the existing auth identity/identities for this customer.
      let existingIdentities: any[] = []
      try {
        existingIdentities = await authModule.listAuthIdentities({
          app_metadata: { customer_id: registeredRow.id },
        } as any)
      } catch {
        existingIdentities = []
      }

      if (!existingIdentities.length) {
        try {
          existingIdentities = await authModule.listAuthIdentities({
            provider_identities: { entity_id: emailLc, provider: "emailpass" },
          } as any)
        } catch {
          existingIdentities = []
        }
      }

      // Delete old identities FIRST to free the email for re-registration.
      // If the subsequent register() fails, we recreate identities from
      // the old ones to avoid locking the customer out completely.
      for (const identity of existingIdentities) {
        try {
          await authModule.deleteAuthIdentities([identity.id])
        } catch (e: any) {
          logger.warn(
            `[Wholesale Reapply] Failed to delete auth identity ${identity.id}: ${e.message}`
          )
        }
      }

      let reapplyAuthResult
      try {
        reapplyAuthResult = await authModule.register("emailpass", {
          body: { email: emailLc, password: body.password },
        } as any)
      } catch (authError: any) {
        logger.error(
          `[Wholesale Reapply] Failed to register new auth identity for ${emailLc}: ${authError.message}. Customer ${registeredRow.id} may now be locked out — admin must reset password.`
        )
        res.status(500).json({
          message:
            "Reapplication failed due to an internal error. Please contact support at orders@arrottigroup.com.",
        })
        return
      }

      if (!reapplyAuthResult?.success || !reapplyAuthResult.authIdentity) {
        logger.error(
          `[Wholesale Reapply] register() returned unsuccessful for ${emailLc}. Customer ${registeredRow.id} may now be locked out.`
        )
        res.status(400).json({
          message:
            reapplyAuthResult?.error ||
            "Failed to reset authentication. Please contact support.",
        })
        return
      }

      const newAuthIdentityId = reapplyAuthResult.authIdentity.id

      const priorMetadata = registeredMetadata || {}
      const {
        rejected_at: _ra,
        rejected_by: _rb,
        rejection_reason: _rr,
        ...carriedMetadata
      } = priorMetadata as Record<string, any>

      const reapplyMetadata: Record<string, any> = {
        ...carriedMetadata,
        tax_id: body.tax_id || carriedMetadata.tax_id || null,
        tax_documents:
          taxDocuments.length > 0
            ? taxDocuments
            : carriedMetadata.tax_documents || [],
        registration_date: new Date().toISOString(),
        pending_approval: true,
        registration_source: "wholesale_portal",
        reapplied_at: new Date().toISOString(),
        reapply_count: (carriedMetadata.reapply_count || 0) + 1,
        // Medusa merges metadata on update; explicit nulls are required
        // to actually remove keys rather than just leave the old values.
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
      }

      const [updated] = await customerModule.updateCustomers(
        [registeredRow.id],
        {
          first_name: body.first_name,
          last_name: body.last_name,
          email: emailLc,
          company_name: body.company_name || null,
          phone: normalizedPhone,
          metadata: reapplyMetadata,
        }
      )

      const existingAuth = await authModule.retrieveAuthIdentity(newAuthIdentityId)
      await authModule.updateAuthIdentities({
        id: newAuthIdentityId,
        app_metadata: {
          ...(existingAuth.app_metadata || {}),
          customer_id: registeredRow.id,
        },
      })

      customerResult = {
        id: updated.id,
        email: emailLc,
        first_name: updated.first_name ?? null,
        last_name: updated.last_name ?? null,
        company_name: updated.company_name ?? null,
      }

      const eventBus = req.scope.resolve(Modules.EVENT_BUS)
      await eventBus.emit({
        name: "customer.wholesale_reapplied",
        data: { id: registeredRow.id },
      })

      logger.info(
        `[Wholesale Reapply] Customer ${registeredRow.id} (${emailLc}) resubmitted wholesale application (attempt ${reapplyMetadata.reapply_count})`
      )
    } else {
    // 3. Register auth identity (email/password)

    let authResult
    try {
      authResult = await authModule.register("emailpass", {
        body: {
          email: emailLc,
          password: body.password,
        },
      } as any)
    } catch (authError: any) {
      // Auth identity already exists (possibly orphaned from a previous failed registration)
      // Don't attempt cleanup from a public endpoint — return conflict
      if (authError.message?.includes("already exists") || authError.message?.includes("duplicate") || authError.message?.includes("Identity")) {
        logger.warn(`[Wholesale Registration] Auth identity conflict for ${body.email}`)
        res.status(409).json({
          message: "An account with this email already exists. Please sign in or contact support.",
        })
        return
      }
      throw authError
    }

    if (!authResult || !authResult.success || !authResult.authIdentity) {
      res.status(400).json({
        message: authResult?.error || "Failed to create authentication",
      })
      return
    }

    const authIdentityId = authResult.authIdentity.id

    const registrationMetadata = {
      tax_id: body.tax_id || null,
      tax_documents: taxDocuments,
      registration_date: new Date().toISOString(),
      pending_approval: true,
      registration_source: "wholesale_portal",
    }

    if (guestRow) {
      // Upgrade-in-place: keep the existing guest row so historical
      // carts/orders stay attached. Then link the auth_identity to it.
      const mergedMetadata = {
        ...((guestRow.metadata as Record<string, unknown> | null) || {}),
        ...registrationMetadata,
      }

      const [updated] = await customerModule.updateCustomers(
        [guestRow.id],
        {
          first_name: body.first_name,
          last_name: body.last_name,
          email: emailLc,
          company_name: body.company_name || null,
          phone: normalizedPhone,
          metadata: mergedMetadata,
        }
      )

      // updateCustomers' DTO does not expose has_account, so flip it
      // explicitly via raw SQL. Required for the partial unique index
      // and any downstream "is registered" checks to recognize the row.
      await db.raw(
        `UPDATE customer SET has_account = true, updated_at = NOW() WHERE id = ?`,
        [guestRow.id]
      )

      // If updateAuthIdentities throws here, the auth_identity is left
      // orphaned (no customer_id linked). Same risk profile as the create
      // branch — handled by ops cleanup, not auto-recovery from a public
      // endpoint.
      const existingAuth = await authModule.retrieveAuthIdentity(authIdentityId)
      await authModule.updateAuthIdentities({
        id: authIdentityId,
        app_metadata: {
          ...(existingAuth.app_metadata || {}),
          customer_id: guestRow.id,
        },
      })

      customerResult = {
        id: updated.id,
        email: emailLc,
        first_name: updated.first_name ?? null,
        last_name: updated.last_name ?? null,
        company_name: updated.company_name ?? null,
      }

      logger.info(
        `[Wholesale Registration] Upgraded guest ${guestRow.id} to wholesale account (${emailLc})`
      )
    } else {
      const customerData = {
        first_name: body.first_name,
        last_name: body.last_name,
        email: emailLc,
        company_name: body.company_name || null,
        phone: normalizedPhone,
        has_account: true,
        metadata: registrationMetadata,
      }

      try {
        const { result } = await createCustomerAccountWorkflow(req.scope).run({
          input: {
            authIdentityId,
            customerData,
          },
        })
        customerResult = {
          id: result.id,
          email: emailLc,
          first_name: result.first_name ?? null,
          last_name: result.last_name ?? null,
          company_name: result.company_name ?? null,
        }
      } catch (err: any) {
        const msg = (err?.message || "") + " " + (err?.detail || "")
        if (
          msg.includes("customer_email_has_account_uniq") ||
          msg.includes("duplicate key value") ||
          err?.code === "23505"
        ) {
          logger.warn(
            `[Wholesale Registration] Unique index blocked duplicate for ${emailLc}`
          )
          res.status(409).json({
            message: "An account with this email already exists. Please sign in instead.",
          })
          return
        }
        throw err
      }

      logger.info(
        `[Wholesale Registration] Created wholesale customer ${customerResult.id} (${emailLc})`
      )
    }
    }

    // Persist the billing address on the customer account so checkout,
    // QBO sync, and tax lookup can use it. Also marked as default shipping
    // per product decision (B2B customers typically ship to the same place).
    //
    // On reapply, update the existing default billing address in place
    // instead of appending a duplicate.
    try {
      const addressPayload = {
        first_name: body.first_name,
        last_name: body.last_name,
        company: body.company_name || undefined,
        address_1: body.address_1!.trim(),
        address_2: body.address_2?.trim() || undefined,
        city: body.city!.trim(),
        province: body.province!.trim(),
        postal_code: body.postal_code!.trim(),
        country_code: (body.country_code || "us").trim().toLowerCase(),
        phone: normalizedPhone,
        is_default_billing: true,
        is_default_shipping: true,
      }

      if (isReapply) {
        const existingAddresses = await customerModule.listCustomerAddresses({
          customer_id: customerResult.id,
        })
        const defaultBilling = existingAddresses.find(
          (a: any) => a.is_default_billing
        )
        if (defaultBilling) {
          await customerModule.updateCustomerAddresses(defaultBilling.id, addressPayload)
        } else {
          await customerModule.createCustomerAddresses([{
            customer_id: customerResult.id,
            ...addressPayload,
          }])
        }
      } else {
        await customerModule.createCustomerAddresses([{
          customer_id: customerResult.id,
          ...addressPayload,
        }])
      }
    } catch (addrErr: any) {
      // Don't fail registration if the address write fails — log and move on;
      // the customer can add one at first checkout.
      logger.warn(
        `[Wholesale Registration] Failed to write billing address for ${emailLc}: ${addrErr.message}`
      )
    }

    res.status(201).json({
      customer: customerResult,
      message: "Registration successful. Your account is pending approval.",
    })
    return
  } catch (error: any) {
    logger.error(
      `[Wholesale Registration] Error: ${error.message}`
    )

    // Handle specific errors
    if (error.message?.includes("duplicate") || error.message?.includes("already exists")) {
      res.status(409).json({
        message: "An account with this email already exists",
      })
      return
    }

    res.status(500).json({
      message: "Registration failed. Please try again later.",
    })
  }
}
