import { Logger, type AppAdapter, type AdapterContext } from '@forinda/kickjs'
import { MailerService, MAILER } from './mailer.service'
import type { MailerOptions } from './types'

const log = Logger.for('MailerAdapter')

/**
 * Mailer adapter — registers MailerService in the DI container.
 *
 * @example
 * ```ts
 * import { MailerAdapter, SmtpProvider } from '@forinda/kickjs-mailer'
 *
 * bootstrap({
 *   adapters: [
 *     new MailerAdapter({
 *       provider: new SmtpProvider({ host: 'smtp.gmail.com', port: 587, auth: { ... } }),
 *       defaultFrom: { name: 'My App', address: 'noreply@myapp.com' },
 *     }),
 *   ],
 * })
 * ```
 */
export class MailerAdapter implements AppAdapter {
  name = 'MailerAdapter'
  private readonly mailer: MailerService

  constructor(private readonly options: MailerOptions) {
    this.mailer = new MailerService(options)
  }

  beforeStart({ container }: AdapterContext): void {
    container.registerInstance(MAILER, this.mailer)
    log.info(
      `Mail provider: ${this.options.provider.name}${this.options.enabled === false ? ' (disabled)' : ''}`,
    )
  }

  async shutdown(): Promise<void> {
    await this.mailer.shutdown()
    log.info('Mailer shut down')
  }
}
