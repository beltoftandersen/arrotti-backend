import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"
import type {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
  Logger,
} from "@medusajs/framework/types"

type InjectedDependencies = {
  logger: Logger
}

export type SMTPNotificationOptions = {
  // SMTP connection
  host: string
  port?: number
  secure?: boolean // true for 465, false for other ports
  // Authentication
  username: string
  password: string
  // Email defaults
  from: string
  fromName?: string
}

class SMTPNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-smtp"

  protected logger_: Logger
  protected options_: SMTPNotificationOptions
  protected transporter_: Transporter

  constructor(
    { logger }: InjectedDependencies,
    options: SMTPNotificationOptions
  ) {
    super()
    this.logger_ = logger
    this.options_ = options

    // Determine port and security
    const port = options.port || (options.secure ? 465 : 587)
    const secure = options.secure ?? port === 465

    // Initialize Nodemailer transporter
    this.transporter_ = nodemailer.createTransport({
      host: options.host,
      port,
      secure,
      auth: {
        user: options.username,
        pass: options.password,
      },
    })

    this.logger_.info(
      `SMTP Notification Provider initialized: ${options.host}:${port}`
    )
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SMTP host is required in the provider options."
      )
    }
    if (!options.username) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SMTP username is required in the provider options."
      )
    }
    if (!options.password) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SMTP password is required in the provider options."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "From email address is required in the provider options."
      )
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const { to, template, data } = notification

    // Build email content from data
    const subject = (data?.subject as string) || template || "Notification"
    const htmlBody = data?.html as string | undefined
    const textBody = data?.text as string | undefined
    const replyTo = data?.replyTo as string | undefined
    const attachments = data?.attachments as any[] | undefined

    if (!htmlBody && !textBody) {
      this.logger_.warn(
        `SMTP notification to ${to} has no html or text body. Template: ${template}`
      )
    }

    // Build from address
    const fromAddress = this.options_.fromName
      ? `"${this.options_.fromName}" <${this.options_.from}>`
      : this.options_.from

    try {
      const result = await this.transporter_.sendMail({
        from: fromAddress,
        to,
        subject,
        html: htmlBody,
        text: textBody,
        replyTo,
        attachments,
      })

      this.logger_.info(
        `SMTP email sent successfully to ${to}. MessageId: ${result.messageId}`
      )

      return {
        id: result.messageId || `smtp-${Date.now()}`,
      }
    } catch (error) {
      this.logger_.error(
        `Failed to send SMTP email to ${to}: ${error.message}`,
        error
      )
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send email via SMTP: ${error.message}`
      )
    }
  }
}

export default SMTPNotificationProviderService
