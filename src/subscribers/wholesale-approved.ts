import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h } from "../lib/html-escape"

type WholesaleApprovedData = {
  id: string
}

const B2B_PORTAL_URL = process.env.B2B_PORTAL_URL || "https://b2b.chimkins.com"

/**
 * Subscriber for wholesale customer approval.
 * Sends an approval email to the customer when their account is approved.
 */
export default async function wholesaleApprovedHandler({
  event: { data },
  container,
}: SubscriberArgs<WholesaleApprovedData>) {
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
        "metadata",
      ],
      filters: {
        id: data.id,
      },
    })

    if (!customer) {
      logger.warn(`[Wholesale Approved] Customer ${data.id} not found`)
      return
    }

    if (!customer.email) {
      logger.warn(`[Wholesale Approved] Customer ${data.id} has no email`)
      return
    }

    const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer"
    const companyName = customer.company_name || ""

    const html = `
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
          <h1 style="color: #28a745; margin-bottom: 10px;">Account Approved!</h1>
          <p style="color: #666; font-size: 16px;">Your wholesale account is now active</p>
        </div>

        <p>Hi ${h(customerName)},</p>

        <p>Great news! Your wholesale account application has been reviewed and approved. You now have full access to our wholesale portal.</p>

        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #007ffd; margin: 0 0 15px;">What You Can Do Now</h3>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            <li style="margin-bottom: 8px;">Access exclusive wholesale pricing</li>
            <li style="margin-bottom: 8px;">Place bulk orders for your business</li>
            <li style="margin-bottom: 8px;">View your order history and track shipments</li>
            <li style="margin-bottom: 8px;">Set up recurring orders for frequently purchased items</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${B2B_PORTAL_URL}/us/login"
             style="display: inline-block; background-color: #007ffd; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Log In to Your Account
          </a>
        </div>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333;">Need Help?</h3>
          <p style="margin: 0; color: #666;">
            Our wholesale support team is here to assist you. Reach out anytime at
            <a href="mailto:webstore@arrottigroup.com" style="color: #007ffd;">webstore@arrottigroup.com</a>
            or call us at <strong>(407) 286-0498</strong>.
          </p>
        </div>

        <p>We're excited to have you as a wholesale partner and look forward to serving your business!</p>

        <p style="color: #666;">
          Best regards,<br>
          <strong>The Arrotti Group Team</strong>
        </p>

        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
          <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
          <p style="margin-top: 10px;">
            <a href="${B2B_PORTAL_URL}" style="color: #007ffd;">Wholesale Portal</a>
          </p>
        </div>
      </body>
      </html>
    `

    const text = `
ACCOUNT APPROVED!

Your wholesale account is now active.

Hi ${customerName},

Great news! Your wholesale account application has been reviewed and approved. You now have full access to our wholesale portal.

What You Can Do Now:
- Access exclusive wholesale pricing
- Place bulk orders for your business
- View your order history and track shipments
- Set up recurring orders for frequently purchased items

Log in to your account: ${B2B_PORTAL_URL}/us/login

Need Help?
Our wholesale support team is here to assist you. Reach out anytime at webstore@arrottigroup.com or call us at (407) 286-0498.

We're excited to have you as a wholesale partner and look forward to serving your business!

Best regards,
The Arrotti Group Team

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    await notificationModuleService.createNotifications({
      to: customer.email,
      channel: "email",
      template: "wholesale-approved",
      data: {
        subject: "Your Wholesale Account Has Been Approved!",
        html,
        text,
      },
    })

    logger.info(
      `[Wholesale Approved] Sent approval email to ${customer.email} (customer ${customer.id})`
    )
  } catch (error) {
    logger.error(
      `[Wholesale Approved] Error sending approval email for customer ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.wholesale_approved",
}
