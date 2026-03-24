import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { h } from "../../../lib/html-escape"

/**
 * Escape HTML then convert newlines to <br> tags.
 * Must escape FIRST to prevent XSS via user input.
 */
function escapeHtmlMultiline(text: string): string {
  return h(text).replace(/\n/g, "<br>")
}

interface ContactFormData {
  firstName: string
  lastName: string
  email: string
  phone?: string
  subject: string
  message: string
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { firstName, lastName, email, phone, subject, message } = req.body as ContactFormData

  // Validate required fields
  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address" })
  }

  try {
    const notificationService = req.scope.resolve(Modules.NOTIFICATION)

    // Email to company (contact form submission)
    const companyEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #001a33; color: white; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 20px; background: #f9f9f9; }
    .field { margin-bottom: 15px; }
    .field-label { font-weight: bold; color: #001a33; }
    .field-value { margin-top: 5px; }
    .message-box { background: white; padding: 15px; border-left: 4px solid #007ffd; margin-top: 10px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Contact Form Submission</h1>
    </div>
    <div class="content">
      <div class="field">
        <div class="field-label">Name:</div>
        <div class="field-value">${h(firstName)} ${h(lastName)}</div>
      </div>
      <div class="field">
        <div class="field-label">Email:</div>
        <div class="field-value"><a href="mailto:${h(email)}">${h(email)}</a></div>
      </div>
      ${phone ? `
      <div class="field">
        <div class="field-label">Phone:</div>
        <div class="field-value"><a href="tel:${h(phone)}">${h(phone)}</a></div>
      </div>
      ` : ""}
      <div class="field">
        <div class="field-label">Subject:</div>
        <div class="field-value">${h(subject)}</div>
      </div>
      <div class="field">
        <div class="field-label">Message:</div>
        <div class="message-box">${escapeHtmlMultiline(message)}</div>
      </div>
    </div>
    <div class="footer">
      This message was sent from the Arrotti Group website contact form.
    </div>
  </div>
</body>
</html>
`

    const companyEmailText = `
New Contact Form Submission

Name: ${firstName} ${lastName}
Email: ${email}
${phone ? `Phone: ${phone}` : ""}
Subject: ${subject}

Message:
${message}

---
This message was sent from the Arrotti Group website contact form.
`

    // Send email to company
    await notificationService.createNotifications({
      to: process.env.CONTACT_EMAIL || "info@arrottigroup.com",
      channel: "email",
      template: "contact-form",
      data: {
        subject: `Contact Form: ${subject}`,
        html: companyEmailHtml,
        text: companyEmailText,
        replyTo: email,
      },
    })

    // Send confirmation email to customer
    const confirmationHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #001a33; color: white; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 20px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Thank You for Contacting Us</h1>
    </div>
    <div class="content">
      <p>Dear ${h(firstName)},</p>
      <p>Thank you for reaching out to Arrotti Group. We have received your message and will get back to you within 24 hours.</p>
      <p><strong>Your message:</strong></p>
      <p style="background: #f5f5f5; padding: 15px; border-radius: 5px;">${escapeHtmlMultiline(message)}</p>
      <p>If you need immediate assistance, please call us at <strong>(407) 286-0498</strong>.</p>
      <p>Best regards,<br>The Arrotti Group Team</p>
    </div>
    <div class="footer">
      <p>Arrotti Group LLC<br>
      4651 36th Street, Suite 500<br>
      Orlando, FL 32811, USA</p>
    </div>
  </div>
</body>
</html>
`

    await notificationService.createNotifications({
      to: email,
      channel: "email",
      template: "contact-confirmation",
      data: {
        subject: "Thank you for contacting Arrotti Group",
        html: confirmationHtml,
      },
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Contact form error:", error)
    res.status(500).json({
      error: "Failed to send message. Please try again later."
    })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ message: "Contact endpoint is working. Use POST to submit a message." })
}
