// ── Mail Message ────────────────────────────────────────────────────────

export interface MailAddress {
  name?: string
  address: string
}

export type MailRecipient = string | MailAddress

export interface MailAttachment {
  filename: string
  content?: string | Buffer
  path?: string
  contentType?: string
  encoding?: string
}

export interface MailMessage {
  /** Sender address */
  from?: MailRecipient
  /** Recipient(s) */
  to: MailRecipient | MailRecipient[]
  /** CC recipient(s) */
  cc?: MailRecipient | MailRecipient[]
  /** BCC recipient(s) */
  bcc?: MailRecipient | MailRecipient[]
  /** Reply-to address */
  replyTo?: MailRecipient
  /** Email subject */
  subject: string
  /** Plain text body */
  text?: string
  /** HTML body */
  html?: string
  /** File attachments */
  attachments?: MailAttachment[]
  /** Custom headers */
  headers?: Record<string, string>
  /** Provider-specific options (e.g. Resend tags, SES configuration set) */
  metadata?: Record<string, any>
}

export interface MailResult {
  /** Provider-assigned message ID */
  messageId: string
  /** Whether the send was accepted (does not guarantee delivery) */
  accepted: boolean
  /** Raw response from the provider */
  raw?: any
}

// ── Template Engine ─────────────────────────────────────────────────────

/**
 * Template engine for rendering email bodies.
 * Implement this to use EJS, Handlebars, Pug, or any template system.
 *
 * @example
 * ```ts
 * import Handlebars from 'handlebars'
 *
 * class HandlebarsEngine implements MailTemplateEngine {
 *   private templates = new Map<string, HandlebarsTemplateDelegate>()
 *
 *   register(name: string, source: string) {
 *     this.templates.set(name, Handlebars.compile(source))
 *   }
 *
 *   async render(template: string, data: any) {
 *     const fn = this.templates.get(template)
 *     if (!fn) throw new Error(`Template "${template}" not found`)
 *     return fn(data)
 *   }
 * }
 * ```
 */
export interface MailTemplateEngine {
  /** Render a named template with data. Returns HTML string. */
  render(template: string, data: Record<string, any>): Promise<string> | string
}

// ── Mail Provider ───────────────────────────────────────────────────────

/**
 * Abstract mail provider. Implement this to use any email service:
 * SMTP (nodemailer), Resend, AWS SES, SendGrid, Postmark, Mailgun, etc.
 *
 * @example
 * ```ts
 * class ResendProvider implements MailProvider {
 *   name = 'resend'
 *   private client: Resend
 *
 *   constructor(apiKey: string) {
 *     this.client = new Resend(apiKey)
 *   }
 *
 *   async send(message: MailMessage): Promise<MailResult> {
 *     const { data, error } = await this.client.emails.send({
 *       from: formatAddress(message.from),
 *       to: formatRecipients(message.to),
 *       subject: message.subject,
 *       html: message.html,
 *       text: message.text,
 *     })
 *     if (error) throw error
 *     return { messageId: data.id, accepted: true, raw: data }
 *   }
 * }
 * ```
 */
export interface MailProvider {
  /** Provider name for logging */
  name: string

  /** Send an email message */
  send(message: MailMessage): Promise<MailResult>

  /** Optional cleanup (close connections, etc.) */
  shutdown?(): Promise<void>
}

// ── Mailer Options ──────────────────────────────────────────────────────

export interface MailerOptions {
  /** Mail provider to use */
  provider: MailProvider

  /** Default "from" address for all emails */
  defaultFrom?: MailRecipient

  /** Optional template engine for rendering HTML from templates */
  templateEngine?: MailTemplateEngine

  /** Enable/disable sending (useful for testing — logs instead of sending) */
  enabled?: boolean
}
