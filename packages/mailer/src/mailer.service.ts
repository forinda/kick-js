import { Logger, createToken } from '@forinda/kickjs'
import type {
  MailProvider,
  MailMessage,
  MailResult,
  MailRecipient,
  MailTemplateEngine,
  MailerOptions,
} from './types'

const log = Logger.for('Mailer')

/** DI token for resolving MailerService from the container. */
export const MAILER = createToken<MailerService>('kick/mailer/Service')

/**
 * Central mail service — send emails through any provider.
 *
 * @example
 * ```ts
 * @Service()
 * class UserService {
 *   constructor(@Inject(MAILER) private mailer: MailerService) {}
 *
 *   async sendWelcome(user: User) {
 *     await this.mailer.send({
 *       to: user.email,
 *       subject: 'Welcome!',
 *       html: '<h1>Welcome to our app</h1>',
 *     })
 *   }
 *
 *   // Or with templates:
 *   async sendInvoice(user: User, invoice: Invoice) {
 *     await this.mailer.sendTemplate('invoice', {
 *       to: user.email,
 *       subject: `Invoice #${invoice.number}`,
 *     }, { user, invoice })
 *   }
 * }
 * ```
 */
export class MailerService {
  private readonly provider: MailProvider
  private readonly defaultFrom?: MailRecipient
  private readonly templateEngine?: MailTemplateEngine
  private readonly enabled: boolean

  // Counters surfaced via the MailerAdapter's introspect() to DevTools
  // (architecture.md §23). Public + readonly externally so the adapter
  // wrapper reads them without coupling to internal field layout.
  /** Total messages successfully accepted by the provider. */
  public sentCount = 0
  /** Total messages that threw inside provider.send(). */
  public failedCount = 0
  /** Total messages skipped because `enabled = false` (dry-run mode). */
  public dryRunCount = 0

  constructor(options: MailerOptions) {
    this.provider = options.provider
    this.defaultFrom = options.defaultFrom
    this.templateEngine = options.templateEngine
    this.enabled = options.enabled ?? true
  }

  /**
   * Send an email message.
   * Applies defaultFrom if no from address is set.
   */
  async send(message: MailMessage): Promise<MailResult> {
    const msg = { ...message }

    // Apply default from
    if (!msg.from && this.defaultFrom) {
      msg.from = this.defaultFrom
    }

    if (!this.enabled) {
      this.dryRunCount++
      log.info(`[dry-run] → ${formatRecipient(msg.to)} | ${msg.subject}`)
      return { messageId: 'dry-run', accepted: true }
    }

    try {
      const result = await this.provider.send(msg)
      this.sentCount++
      log.info(`Sent → ${formatRecipient(msg.to)} | ${msg.subject} [${result.messageId}]`)
      return result
    } catch (err: any) {
      this.failedCount++
      log.error({ err }, `Failed → ${formatRecipient(msg.to)} | ${msg.subject}`)
      throw err
    }
  }

  /**
   * Render a template and send the resulting HTML as an email.
   * Requires a templateEngine to be configured.
   *
   * @param template - Template name (resolved by the engine)
   * @param message - Mail message (html will be overwritten by the rendered template)
   * @param data - Template variables
   */
  async sendTemplate(
    template: string,
    message: Omit<MailMessage, 'html'>,
    data: Record<string, any>,
  ): Promise<MailResult> {
    if (!this.templateEngine) {
      throw new Error(
        'MailerService: templateEngine is required for sendTemplate(). ' +
          'Pass one in MailerOptions or use send() with raw HTML.',
      )
    }

    const html = await this.templateEngine.render(template, data)
    return this.send({ ...message, html })
  }

  /** Get the underlying provider (for advanced use) */
  getProvider(): MailProvider {
    return this.provider
  }

  /** Shutdown the provider */
  async shutdown(): Promise<void> {
    if (this.provider.shutdown) {
      await this.provider.shutdown()
    }
  }
}

function formatRecipient(to: MailRecipient | MailRecipient[]): string {
  if (Array.isArray(to)) {
    return to.map((r) => (typeof r === 'string' ? r : r.address)).join(', ')
  }
  return typeof to === 'string' ? to : to.address
}
