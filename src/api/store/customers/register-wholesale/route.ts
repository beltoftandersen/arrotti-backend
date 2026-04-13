import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"

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
    if (registeredRow) {
      res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
      })
      return
    }

    const guestRow = existingRows.find((r: any) => r.has_account === false)

    // 3. Register auth identity (email/password)
    const authModule = req.scope.resolve(Modules.AUTH)

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

    let customerResult: {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      company_name: string | null
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
          phone: body.phone || null,
          has_account: true,
          metadata: mergedMetadata,
        } as any
      )

      const authModuleForLink = req.scope.resolve(Modules.AUTH)
      const existingAuth = await authModuleForLink.retrieveAuthIdentity(
        authIdentityId
      )
      await authModuleForLink.updateAuthIdentities({
        id: authIdentityId,
        app_metadata: {
          ...(existingAuth.app_metadata || {}),
          customer_id: guestRow.id,
        },
      })

      customerResult = {
        id: updated.id,
        email: updated.email,
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
        phone: body.phone || null,
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
          email: result.email,
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
