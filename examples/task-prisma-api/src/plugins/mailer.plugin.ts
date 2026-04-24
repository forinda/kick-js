import { definePlugin, createToken, Logger } from '@forinda/kickjs'
import nodemailer, { type Transporter } from 'nodemailer'

const log = Logger.for('Mailer')

// ── Mail message shape (mirrors the previous @forinda/kickjs-mailer types) ──

export interface MailAddress {
  name?: string
  address: string
}

export type MailRecipient = string | MailAddress

export interface MailMessage {
  from?: MailRecipient
  to: MailRecipient | MailRecipient[]
  cc?: MailRecipient | MailRecipient[]
  bcc?: MailRecipient | MailRecipient[]
  replyTo?: MailRecipient
  subject: string
  text?: string
  html?: string
  headers?: Record<string, string>
}

export interface MailResult {
  messageId: string
  accepted: boolean
}

export interface MailerService {
  send(message: MailMessage): Promise<MailResult>
}

// DI token consumers resolve via `@Autowired(MAILER)` or `@Inject(MAILER)`.
export const MAILER = createToken<MailerService>('app/mailer/service')

// ── Provider: console (dev / no-SMTP) ───────────────────────────────────

class ConsoleMailer implements MailerService {
  private counter = 0
  constructor(private readonly defaultFrom?: MailRecipient) {}

  async send(message: MailMessage): Promise<MailResult> {
    const id = `console-${++this.counter}`
    const from = message.from ?? this.defaultFrom
    log.info('────────────────────────────────────────')
    log.info(`From:    ${formatAddr(from)}`)
    log.info(`To:      ${formatAddr(message.to)}`)
    if (message.cc) log.info(`CC:      ${formatAddr(message.cc)}`)
    if (message.bcc) log.info(`BCC:     ${formatAddr(message.bcc)}`)
    log.info(`Subject: ${message.subject}`)
    if (message.text) log.info(`Text:    ${truncate(message.text)}`)
    if (message.html) log.info(`HTML:    ${truncate(message.html)}`)
    log.info(`ID:      ${id}`)
    log.info('────────────────────────────────────────')
    return { messageId: id, accepted: true }
  }
}

// ── Provider: SMTP (nodemailer) ─────────────────────────────────────────

class SmtpMailer implements MailerService {
  constructor(
    private readonly transporter: Transporter,
    private readonly defaultFrom?: MailRecipient,
  ) {}

  async send(message: MailMessage): Promise<MailResult> {
    const from = formatAddr(message.from ?? this.defaultFrom)
    const info = await this.transporter.sendMail({
      from,
      to: toNodemailerRecipient(message.to),
      cc: message.cc ? toNodemailerRecipient(message.cc) : undefined,
      bcc: message.bcc ? toNodemailerRecipient(message.bcc) : undefined,
      replyTo: message.replyTo ? formatAddr(message.replyTo) : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    })
    log.info(`Sent → ${formatAddr(message.to)} | ${message.subject} [${info.messageId}]`)
    return { messageId: info.messageId, accepted: true }
  }
}

// ── Plugin ──────────────────────────────────────────────────────────────

export interface MailerConfig {
  /** SMTP transport URL — when omitted, falls back to the console mailer. */
  smtpUrl?: string
  /** Default `From:` address applied when a message omits `from`. */
  defaultFrom?: MailRecipient
}

export const MailerPlugin = definePlugin<MailerConfig>({
  name: 'MailerPlugin',
  build: (config) => ({
    register(container) {
      const service: MailerService = config.smtpUrl
        ? new SmtpMailer(nodemailer.createTransport(config.smtpUrl), config.defaultFrom)
        : new ConsoleMailer(config.defaultFrom)
      container.registerInstance(MAILER, service)
    },
  }),
})

// ── Helpers ─────────────────────────────────────────────────────────────

function formatAddr(addr: MailRecipient | MailRecipient[] | undefined): string {
  if (!addr) return '(none)'
  if (Array.isArray(addr)) return addr.map(formatAddr).join(', ')
  if (typeof addr === 'string') return addr
  return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address
}

function toNodemailerRecipient(
  addr: MailRecipient | MailRecipient[],
): string | string[] {
  if (Array.isArray(addr)) return addr.map((r) => formatAddr(r))
  return formatAddr(addr)
}

function truncate(s: string): string {
  return s.length > 200 ? `${s.slice(0, 200)}...` : s
}
