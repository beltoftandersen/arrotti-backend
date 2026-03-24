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

    // 2. Check if customer with this email already exists
    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const existingCustomers = await customerModule.listCustomers({ email: body.email })

    if (existingCustomers.length > 0) {
      res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
      })
      return
    }

    // 3. Register auth identity (email/password)
    const authModule = req.scope.resolve(Modules.AUTH)

    let authResult
    try {
      authResult = await authModule.register("emailpass", {
        body: {
          email: body.email,
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

    // 4. Create customer account linked to auth identity
    const customerData = {
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      company_name: body.company_name || null,
      phone: body.phone || null,
      has_account: true,
      metadata: {
        tax_id: body.tax_id || null,
        tax_documents: taxDocuments,
        registration_date: new Date().toISOString(),
        pending_approval: true,
        registration_source: "wholesale_portal",
      },
    }

    const { result: customerResult } = await createCustomerAccountWorkflow(req.scope).run({
      input: {
        authIdentityId,
        customerData,
      },
    })

    logger.info(
      `[Wholesale Registration] Created wholesale customer ${customerResult.id} (${body.email})`
    )

    // Return success response (user will need to log in separately)
    res.status(201).json({
      customer: {
        id: customerResult.id,
        email: customerResult.email,
        first_name: customerResult.first_name,
        last_name: customerResult.last_name,
        company_name: customerResult.company_name,
      },
      message: "Registration successful. Your account is pending approval.",
    })
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
