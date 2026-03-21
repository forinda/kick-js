import { Logger } from '@forinda/kickjs-core'
import type { NotificationChannel, Notification } from '../types'

const log = Logger.for('ConsoleNotification')

/**
 * Console notification channel — logs notifications.
 * Useful for development and testing.
 */
export class ConsoleChannel implements NotificationChannel {
  name = 'console'

  async send(notification: Notification): Promise<void> {
    const to = Array.isArray(notification.to) ? notification.to.join(', ') : notification.to
    log.info(
      `[${notification.priority ?? 'normal'}] → ${to} | ${notification.subject}: ${notification.message}`,
    )
  }
}
