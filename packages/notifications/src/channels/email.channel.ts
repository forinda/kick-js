import type { NotificationChannel, Notification } from '../types'

/**
 * Email notification channel — bridges to @forinda/kickjs-mailer.
 * Pass your MailerService instance to route notifications as emails.
 *
 * @example
 * ```ts
 * import { EmailChannel } from '@forinda/kickjs-notifications'
 *
 * // mailer is your MailerService instance
 * new EmailChannel({ mailer, defaultFrom: 'alerts@myapp.com' })
 * ```
 */
export class EmailChannel implements NotificationChannel {
  name = 'email'
  private mailer: any
  private defaultFrom?: string

  constructor(options: { mailer: any; defaultFrom?: string }) {
    this.mailer = options.mailer
    this.defaultFrom = options.defaultFrom
  }

  async send(notification: Notification): Promise<void> {
    const recipients = Array.isArray(notification.to) ? notification.to : [notification.to]

    await this.mailer.send({
      from: this.defaultFrom,
      to: recipients,
      subject: notification.subject,
      text: notification.message,
      html: notification.html,
    })
  }
}
