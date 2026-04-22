import { Logger, defineAdapter } from '@forinda/kickjs'
import { NotificationService, NOTIFICATIONS } from './service'
import type { NotificationServiceOptions } from './types'

const log = Logger.for('NotificationAdapter')

/**
 * Notification adapter — registers NotificationService in DI.
 *
 * @example
 * ```ts
 * import { NotificationAdapter, SlackChannel, EmailChannel } from '@forinda/kickjs-notifications'
 *
 * bootstrap({
 *   adapters: [
 *     NotificationAdapter({
 *       channels: [
 *         new SlackChannel({ url: getEnv('SLACK_WEBHOOK') }),
 *         new EmailChannel({ mailer }),
 *       ],
 *       defaultChannels: ['slack'],
 *     }),
 *   ],
 * })
 *
 * // Multi-instance via .scoped() — separate channel sets per audience:
 * bootstrap({
 *   adapters: [
 *     NotificationAdapter.scoped('alerts', { channels: [pagerDuty, opsSlack] }),
 *     NotificationAdapter.scoped('marketing', { channels: [emailChannel] }),
 *   ],
 * })
 * ```
 */
export const NotificationAdapter = defineAdapter<NotificationServiceOptions>({
  name: 'NotificationAdapter',
  build: (options) => {
    const service = new NotificationService(options)

    return {
      afterStart({ container }) {
        container.registerInstance(NOTIFICATIONS, service)
        log.info(`Channels: ${service.getChannelNames().join(', ')}`)
      },
    }
  },
})
