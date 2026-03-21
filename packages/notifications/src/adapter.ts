import { Logger, type AppAdapter, type Container } from '@forinda/kickjs-core'
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
 *     new NotificationAdapter({
 *       channels: [
 *         new SlackChannel({ url: process.env.SLACK_WEBHOOK! }),
 *         new EmailChannel({ mailer }),
 *       ],
 *       defaultChannels: ['slack'],
 *     }),
 *   ],
 * })
 * ```
 */
export class NotificationAdapter implements AppAdapter {
  name = 'NotificationAdapter'
  private service: NotificationService

  constructor(options: NotificationServiceOptions) {
    this.service = new NotificationService(options)
  }

  afterStart(_server: any, container: Container): void {
    container.registerInstance(NOTIFICATIONS, this.service)
    log.info(`Channels: ${this.service.getChannelNames().join(', ')}`)
  }
}
