/**
 * QBO failure alert — emails the admin distribution when a QuickBooks
 * API or OAuth call fails after all retries are exhausted.
 *
 * Uses the same SMTP env vars as the notification-smtp module, but sends
 * directly via nodemailer so it works from anywhere in the codebase
 * (including lib/, which has no access to the Medusa container).
 */

import nodemailer from "nodemailer"

const ALERT_TO =
  process.env.QBO_ALERT_EMAIL_TO ||
  process.env.ALERT_EMAIL_TO ||
  "webstore@arrottigroup.com"

let transporter: nodemailer.Transporter | null = null
let transporterInitError: string | null = null

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter
  if (transporterInitError) return null

  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USERNAME
  const pass = process.env.SMTP_PASSWORD

  if (!host || !user || !pass) {
    transporterInitError = "SMTP_HOST/USERNAME/PASSWORD not set"
    return null
  }

  const port = parseInt(process.env.SMTP_PORT || "587", 10)
  const secure = port === 465

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })

  return transporter
}

export async function sendQboAlert(subject: string, body: string): Promise<void> {
  const tx = getTransporter()
  if (!tx) {
    console.error(`[QBO Alert] cannot send — ${transporterInitError}`)
    return
  }

  const from = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USERNAME || "noreply@arrottigroup.com"
  const fromName = process.env.SMTP_FROM_NAME || "Arrotti QBO"

  try {
    await tx.sendMail({
      from: `"${fromName}" <${from}>`,
      to: ALERT_TO,
      subject: `[arrotti][QBO] ${subject}`,
      text: body,
    })
    console.log(`[QBO Alert] sent to ${ALERT_TO}: ${subject}`)
  } catch (e: any) {
    console.error(`[QBO Alert] send failed: ${e?.message || e}`)
  }
}
