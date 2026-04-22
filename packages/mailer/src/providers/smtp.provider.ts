import type { MailProvider, MailMessage, MailResult } from '../types'

export interface SmtpOptions {
  /** SMTP host (e.g. 'smtp.gmail.com', 'smtp.resend.com') */
  host: string
  /** SMTP port (default: 587) */
  port?: number
  /** Use TLS (default: true for port 465, false otherwise) */
  secure?: boolean
  /** Authentication credentials */
  auth?: {
    user: string
    pass: string
  }
  /** Connection timeout in ms (default: 10000) */
  connectionTimeout?: number
}

/**
 * SMTP mail provider using nodemailer.
 *
 * Requires `nodemailer` as a peer dependency:
 * ```bash
 * pnpm add nodemailer @types/nodemailer
 * ```
 *
 * @example
 * ```ts
 * // Gmail
 * new SmtpProvider({
 *   host: 'smtp.gmail.com',
 *   port: 587,
 *   auth: { user: 'you@gmail.com', pass: 'app-password' },
 * })
 *
 * // Resend via SMTP
 * new SmtpProvider({
 *   host: 'smtp.resend.com',
 *   port: 465,
 *   secure: true,
 *   auth: { user: 'resend', pass: getEnv('RESEND_API_KEY') },
 * })
 *
 * // Mailpit (local dev)
 * new SmtpProvider({ host: 'localhost', port: 1025 })
 * ```
 */
export class SmtpProvider implements MailProvider {
  name = 'smtp'
  private transporter: any

  constructor(private options: SmtpOptions) {}

  private async ensureTransporter(): Promise<void> {
    if (this.transporter) return
    try {
      const nodemailer: any = await import('nodemailer')
      const createTransport = nodemailer.createTransport ?? nodemailer.default?.createTransport
      this.transporter = createTransport({
        host: this.options.host,
        port: this.options.port ?? 587,
        secure: this.options.secure ?? this.options.port === 465,
        auth: this.options.auth,
        connectionTimeout: this.options.connectionTimeout ?? 10000,
      })
    } catch {
      throw new Error('SmtpProvider requires "nodemailer" package. Install: pnpm add nodemailer')
    }
  }

  async send(message: MailMessage): Promise<MailResult> {
    await this.ensureTransporter()

    const result = await this.transporter.sendMail({
      from: formatAddress(message.from),
      to: formatRecipients(message.to),
      cc: message.cc ? formatRecipients(message.cc) : undefined,
      bcc: message.bcc ? formatRecipients(message.bcc) : undefined,
      replyTo: message.replyTo ? formatAddress(message.replyTo) : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      headers: message.headers,
    })

    return {
      messageId: result.messageId,
      accepted: (result.accepted?.length ?? 0) > 0,
      raw: result,
    }
  }

  async shutdown(): Promise<void> {
    if (this.transporter) {
      this.transporter.close()
    }
  }
}

function formatAddress(addr: any): string | undefined {
  if (!addr) return undefined
  if (typeof addr === 'string') return addr
  return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address
}

function formatRecipients(recipients: any): string {
  if (!recipients) return ''
  if (typeof recipients === 'string') return recipients
  if (Array.isArray(recipients)) {
    return recipients.map((r: any) => formatAddress(r)).join(', ')
  }
  return formatAddress(recipients) ?? ''
}
