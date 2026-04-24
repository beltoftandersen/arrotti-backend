import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h, escapeUrl } from "../lib/html-escape"

type CustomerCreatedData = {
  id: string
}

type TaxDocument = {
  filename: string
  url: string
  size: number
  uploaded_at: string
}

type CustomerMetadata = {
  tax_id?: string
  tax_documents?: TaxDocument[]
  registration_date?: string
  pending_approval?: boolean
  registration_source?: string
}

const ADMIN_EMAIL = process.env.CONTACT_EMAIL || "orders@arrottigroup.com"
const B2B_PORTAL_URL = process.env.B2B_PORTAL_URL || "https://arrottigroup.com"

/**
 * Subscriber for wholesale customer registration.
 * Sends two emails when a new wholesale customer registers:
 * 1. Confirmation email to the customer
 * 2. Notification email to admin with customer details and attached documents
 */
export default async function wholesaleRegistrationHandler({
  event: { data },
  container,
}: SubscriberArgs<CustomerCreatedData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")

  try {
    // Get customer details
    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "email",
        "first_name",
        "last_name",
        "company_name",
        "phone",
        "metadata",
        "created_at",
      ],
      filters: {
        id: data.id,
      },
    })

    if (!customer) {
      logger.warn(`[Wholesale Registration] Customer ${data.id} not found`)
      return
    }

    const metadata = customer.metadata as CustomerMetadata | null

    // Only process wholesale registrations (those with pending_approval flag)
    if (!metadata?.pending_approval) {
      logger.debug(`[Wholesale Registration] Customer ${customer.id} is not a wholesale registration`)
      return
    }

    // Ensure customer has email
    if (!customer.email) {
      logger.warn(`[Wholesale Registration] Customer ${customer.id} has no email`)
      return
    }

    const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer"
    const companyName = customer.company_name || "Not provided"
    const taxId = metadata.tax_id || "Not provided"
    const taxDocuments = metadata.tax_documents || []
    const isReapply = Boolean((metadata as any)?.reapplied_at)

    // ============================================
    // 1. Send confirmation email to customer
    // ============================================
    const customerHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://carparts.chimkins.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
        </div>

        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #007ffd; margin-bottom: 10px;">Application Received!</h1>
          <p style="color: #666; font-size: 16px;">Thank you for applying for a wholesale account</p>
        </div>

        <p>Hi ${h(customerName)},</p>

        <p>We've received your wholesale account application. Our team will review your information and get back to you within 1-2 business days.</p>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333;">Application Details</h3>
          <p style="margin: 8px 0;"><strong>Name:</strong> ${h(customerName)}</p>
          <p style="margin: 8px 0;"><strong>Company:</strong> ${h(companyName)}</p>
          <p style="margin: 8px 0;"><strong>Email:</strong> ${h(customer.email)}</p>
          ${taxDocuments.length > 0 ? `<p style="margin: 8px 0;"><strong>Documents Uploaded:</strong> ${taxDocuments.length} file(s)</p>` : ""}
        </div>

        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #007ffd; margin: 0 0 10px;">What's Next?</h3>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            <li>Our team will review your application</li>
            <li>We may contact you if additional information is needed</li>
            <li>You'll receive an email once your account is approved</li>
            <li>After approval, you can log in and start ordering</li>
          </ul>
        </div>

        <p>If you have any questions, feel free to reach out to us at <a href="mailto:orders@arrottigroup.com" style="color: #007ffd;">orders@arrottigroup.com</a>.</p>

        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
          <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
        </div>
      </body>
      </html>
    `

    const customerText = `
Application Received!

Hi ${customerName},

We've received your wholesale account application. Our team will review your information and get back to you within 1-2 business days.

Application Details:
- Name: ${customerName}
- Company: ${companyName}
- Email: ${customer.email}
${taxDocuments.length > 0 ? `- Documents Uploaded: ${taxDocuments.length} file(s)` : ""}

What's Next?
- Our team will review your application
- We may contact you if additional information is needed
- You'll receive an email once your account is approved
- After approval, you can log in and start ordering

If you have any questions, feel free to reach out to us at orders@arrottigroup.com.

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    await notificationModuleService.createNotifications({
      to: customer.email!,
      channel: "email",
      template: "wholesale-registration-customer",
      data: {
        subject: isReapply ? "Wholesale Account Reapplication Received" : "Wholesale Account Application Received",
        html: customerHtml,
        text: customerText,
      },
    })

    logger.info(
      `[Wholesale Registration] Sent confirmation email to ${customer.email}`
    )

    // ============================================
    // 2. Send notification email to admin
    // ============================================
    // Escape document filenames and URLs to prevent injection
    const documentsListHtml = taxDocuments.length > 0
      ? taxDocuments.map((doc: TaxDocument) => `
          <li style="margin-bottom: 8px;">
            <a href="${escapeUrl(doc.url)}" style="color: #007ffd;" target="_blank">${h(doc.filename)}</a>
            <span style="color: #999; font-size: 12px;"> (${formatFileSize(doc.size)})</span>
          </li>
        `).join("")
      : "<li style='color: #999;'>No documents uploaded</li>"

    const adminHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://carparts.chimkins.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
        </div>

        <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ffc107;">
          <h2 style="color: #856404; margin: 0 0 10px;">New Wholesale Application</h2>
          <p style="color: #856404; margin: 0;">A new customer has applied for wholesale access.</p>
        </div>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333;">Customer Information</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #666; width: 120px;"><strong>Name:</strong></td>
              <td style="padding: 8px 0;">${h(customerName)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Company:</strong></td>
              <td style="padding: 8px 0;">${h(companyName)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Email:</strong></td>
              <td style="padding: 8px 0;"><a href="mailto:${h(customer.email)}" style="color: #007ffd;">${h(customer.email)}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Phone:</strong></td>
              <td style="padding: 8px 0;">${h(customer.phone) || "Not provided"}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Tax ID/EIN:</strong></td>
              <td style="padding: 8px 0;">${h(taxId)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;"><strong>Applied:</strong></td>
              <td style="padding: 8px 0;">${new Date(customer.created_at).toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333;">Uploaded Documents</h3>
          <ul style="margin: 0; padding-left: 20px;">
            ${documentsListHtml}
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${B2B_PORTAL_URL}/app/customers/${customer.id}"
             style="display: inline-block; background-color: #007ffd; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View in Admin Panel
          </a>
        </div>

        <p style="color: #666; font-size: 14px;">
          <strong>To approve this customer:</strong> Add them to the "B2B Approved" customer group in the admin panel,
          or use the API endpoint: <code>POST /admin/customers/${customer.id}/approve-wholesale</code>
        </p>

        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
          <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
        </div>
      </body>
      </html>
    `

    const documentsListText = taxDocuments.length > 0
      ? taxDocuments.map((doc: TaxDocument) => `  - ${doc.filename} (${formatFileSize(doc.size)}): ${doc.url}`).join("\n")
      : "  No documents uploaded"

    const adminText = `
NEW WHOLESALE APPLICATION

A new customer has applied for wholesale access.

Customer Information:
- Name: ${customerName}
- Company: ${companyName}
- Email: ${customer.email}
- Phone: ${customer.phone || "Not provided"}
- Tax ID/EIN: ${taxId}
- Applied: ${new Date(customer.created_at).toLocaleString()}

Uploaded Documents:
${documentsListText}

View in Admin Panel:
${B2B_PORTAL_URL}/app/customers/${customer.id}

To approve this customer, add them to the "B2B Approved" customer group,
or use the API endpoint: POST /admin/customers/${customer.id}/approve-wholesale

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    // Prepare attachments from tax documents
    const attachments: Array<{filename: string; path: string}> = taxDocuments.map((doc: TaxDocument) => ({
      filename: doc.filename,
      path: doc.url,
    }))

    await notificationModuleService.createNotifications({
      to: ADMIN_EMAIL,
      channel: "email",
      template: "wholesale-registration-admin",
      data: {
        subject: `${isReapply ? "Wholesale Reapplication" : "New Wholesale Application"}: ${customerName}`,
        html: adminHtml,
        text: adminText,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
    })

    logger.info(
      `[Wholesale Registration] Sent admin notification to ${ADMIN_EMAIL} for customer ${customer.id}`
    )
  } catch (error) {
    logger.error(
      `[Wholesale Registration] Error processing customer ${data.id}: ${(error as Error).message}`
    )
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const config: SubscriberConfig = {
  event: ["customer.created", "customer.wholesale_reapplied"],
}
