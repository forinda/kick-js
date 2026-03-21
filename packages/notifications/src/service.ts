import { Logger } from '@forinda/kickjs-core'
import type {
  NotificationChannel,
  Notification,
  NotificationResult,
  NotificationServiceOptions,
} from './types'

const log = Logger.for('Notifications')

/** DI token for resolving NotificationService */
export const NOTIFICATIONS = Symbol('NotificationService')

/**
 * Multi-channel notification service.
 * Routes notifications to one or more channels (email, Slack, webhook, etc.).
 *
 * @example
 * ```ts
 * @Service()
 * class AlertService {
 *   constructor(@Inject(NOTIFICATIONS) private notify: NotificationService) {}
 *
 *   async alertOps(message: string) {
 *     await this.notify.send({
 *       to: '#ops-alerts',
 *       subject: 'System Alert',
 *       message,
 *       channels: ['slack', 'email'],
 *       priority: 'high',
 *     })
 *   }
 * }
 * ```
 */
export class NotificationService {
  private channels = new Map<string, NotificationChannel>()
  private defaultChannels: string[]

  constructor(options: NotificationServiceOptions) {
    for (const channel of options.channels) {
      this.channels.set(channel.name, channel)
    }
    this.defaultChannels = options.defaultChannels ?? options.channels.map((c) => c.name)
  }

  /** Send a notification through specified or default channels */
  async send(notification: Notification): Promise<NotificationResult[]> {
    const channelNames = notification.channels ?? this.defaultChannels
    const results: NotificationResult[] = []

    for (const name of channelNames) {
      const channel = this.channels.get(name)
      if (!channel) {
        log.warn(`Channel "${name}" not found — skipping`)
        results.push({ channel: name, success: false, error: 'Channel not found' })
        continue
      }

      try {
        await channel.send(notification)
        log.info(`Sent via ${name}: ${notification.subject}`)
        results.push({ channel: name, success: true })
      } catch (err: any) {
        log.error({ err }, `Failed via ${name}: ${notification.subject}`)
        results.push({ channel: name, success: false, error: err.message })
      }
    }

    return results
  }

  /** Send to a specific channel only */
  async sendTo(channelName: string, notification: Notification): Promise<NotificationResult> {
    return (await this.send({ ...notification, channels: [channelName] }))[0]
  }

  /** Get all registered channel names */
  getChannelNames(): string[] {
    return Array.from(this.channels.keys())
  }

  /** Add a channel at runtime */
  addChannel(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel)
  }
}
