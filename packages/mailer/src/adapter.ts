import { Logger, defineAdapter } from '@forinda/kickjs'
import { PROTOCOL_VERSION, type IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'
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
 *     MailerAdapter({
 *       provider: new SmtpProvider({ host: 'smtp.gmail.com', port: 587, auth: { ... } }),
 *       defaultFrom: { name: 'My App', address: 'noreply@myapp.com' },
 *     }),
 *   ],
 * })
 *
 * // Multiple providers via .scoped() — e.g. transactional + marketing pipelines:
 * bootstrap({
 *   adapters: [
 *     MailerAdapter.scoped('transactional', { provider: new ResendProvider({ ... }) }),
 *     MailerAdapter.scoped('marketing', { provider: new SesProvider({ ... }) }),
 *   ],
 * })
 * ```
 */
export const MailerAdapter = defineAdapter<MailerOptions>({
  name: 'MailerAdapter',
  build: (options) => {
    const mailer = new MailerService(options)

    return {
      // ── DevTools introspection (architecture.md §23) ───────────────
      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: PROTOCOL_VERSION,
          name: 'MailerAdapter',
          kind: 'adapter',
          state: {
            provider: options.provider.name,
            enabled: options.enabled !== false,
            hasTemplateEngine: !!options.templateEngine,
          },
          tokens: { provides: ['kick/mailer/Service'], requires: [] },
          metrics: {
            sent: mailer.sentCount,
            failed: mailer.failedCount,
            dryRun: mailer.dryRunCount,
          },
        }
      },

      beforeStart({ container }) {
        container.registerInstance(MAILER, mailer)
        log.info(
          `Mail provider: ${options.provider.name}${options.enabled === false ? ' (disabled)' : ''}`,
        )
      },

      async shutdown() {
        await mailer.shutdown()
        log.info('Mailer shut down')
      },
    }
  },
})
