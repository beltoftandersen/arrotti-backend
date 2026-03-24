import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { h } from "../lib/html-escape"

type PasswordResetData = {
  entity_id: string
  token: string
  actor_type: string
  metadata?: { callback_url?: string }
}

const STOREFRONT_URL =
  process.env.STOREFRONT_URL || "http://localhost:8000"

export default async function passwordResetHandler({
  event: {
    data: { entity_id: email, token, actor_type, metadata },
  },
  container,
}: SubscriberArgs<PasswordResetData>) {
  const logger = container.resolve("logger")
  const notificationModuleService = container.resolve("notification")

  if (actor_type !== "customer") {
    return
  }

  try {
    const callbackUrl = metadata?.callback_url || STOREFRONT_URL
    const resetUrl = `${callbackUrl}/us/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`

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
          <h1 style="color: #333; margin-bottom: 10px;">Reset Your Password</h1>
          <p style="color: #666; font-size: 16px;">We received a request to reset your password</p>
        </div>

        <p>Hi there,</p>

        <p>Someone requested a password reset for the account associated with <strong>${h(email)}</strong>. If this was you, click the button below to set a new password:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${h(resetUrl)}"
             style="display: inline-block; background-color: #007ffd; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Reset Password
          </a>
        </div>

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #666; font-size: 14px;">
            If you didn't request this, you can safely ignore this email. Your password will not be changed.
          </p>
        </div>

        <p style="color: #666; font-size: 14px;">
          This link will expire in 15 minutes for security reasons. If it has expired, you can request a new one from the login page.
        </p>

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
RESET YOUR PASSWORD

We received a request to reset your password.

Hi there,

Someone requested a password reset for the account associated with ${email}. If this was you, visit the link below to set a new password:

${resetUrl}

If you didn't request this, you can safely ignore this email. Your password will not be changed.

This link will expire in 15 minutes for security reasons. If it has expired, you can request a new one from the login page.

Best regards,
The Arrotti Group Team

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    await notificationModuleService.createNotifications({
      to: email,
      channel: "email",
      template: "password-reset",
      data: {
        subject: "Reset Your Password",
        html,
        text,
      },
    })

    logger.info(`[Password Reset] Sent reset email to ${email}`)
  } catch (error) {
    logger.error(
      `[Password Reset] Error sending reset email to ${email}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
