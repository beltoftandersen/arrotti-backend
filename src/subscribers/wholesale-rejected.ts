import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h } from "../lib/html-escape"

type WholesaleRejectedData = {
  id: string
  reason?: string
}

/**
 * Subscriber for wholesale customer rejection.
 * Sends a rejection email to the customer when their application is declined.
 */
export default async function wholesaleRejectedHandler({
  event: { data },
  container,
}: SubscriberArgs<WholesaleRejectedData>) {
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
      logger.warn(`[Wholesale Rejected] Customer ${data.id} not found`)
      return
    }

    if (!customer.email) {
      logger.warn(`[Wholesale Rejected] Customer ${data.id} has no email`)
      return
    }

    const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer"
    const reason = data.reason || "Your application did not meet our wholesale requirements."

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
          <h1 style="color: #333; margin-bottom: 10px;">Application Update</h1>
          <p style="color: #666; font-size: 16px;">Regarding your wholesale account application</p>
        </div>

        <p>Hi ${h(customerName)},</p>

        <p>Thank you for your interest in becoming a wholesale partner with Arrotti Group. After careful review of your application, we regret to inform you that we are unable to approve your wholesale account at this time.</p>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
          <p style="margin: 0; color: #666;"><strong>Reason:</strong></p>
          <p style="margin: 10px 0 0; color: #333;">${h(reason)}</p>
        </div>

        <p>If you believe this decision was made in error or if you have additional documentation that may support your application, please don't hesitate to contact us. We'd be happy to review any new information.</p>

        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #007ffd; margin: 0 0 10px;">Questions?</h3>
          <p style="margin: 0; color: #666;">
            Please reach out to our wholesale team at
            <a href="mailto:webstore@arrottigroup.com" style="color: #007ffd;">webstore@arrottigroup.com</a>
            if you have any questions or would like to discuss this further.
          </p>
        </div>

        <p>We appreciate your understanding and wish you the best in your business endeavors.</p>

        <p style="color: #666;">
          Best regards,<br>
          <strong>The Arrotti Group Team</strong>
        </p>

        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
          <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
        </div>
      </body>
      </html>
    `

    const text = `
APPLICATION UPDATE

Regarding your wholesale account application

Hi ${customerName},

Thank you for your interest in becoming a wholesale partner with Arrotti Group. After careful review of your application, we regret to inform you that we are unable to approve your wholesale account at this time.

Reason: ${reason}

If you believe this decision was made in error or if you have additional documentation that may support your application, please don't hesitate to contact us. We'd be happy to review any new information.

Questions?
Please reach out to our wholesale team at webstore@arrottigroup.com if you have any questions or would like to discuss this further.

We appreciate your understanding and wish you the best in your business endeavors.

Best regards,
The Arrotti Group Team

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    await notificationModuleService.createNotifications({
      to: customer.email,
      channel: "email",
      template: "wholesale-rejected",
      data: {
        subject: "Update on Your Wholesale Account Application",
        html,
        text,
      },
    })

    logger.info(
      `[Wholesale Rejected] Sent rejection email to ${customer.email} (customer ${customer.id})`
    )
  } catch (error) {
    logger.error(
      `[Wholesale Rejected] Error sending rejection email for customer ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.wholesale_rejected",
}
