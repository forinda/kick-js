import type { NotificationChannel, Notification } from '../types'

export interface WebhookChannelOptions {
  /** Webhook URL to POST to */
  url: string
  /** Custom headers (e.g. auth tokens) */
  headers?: Record<string, string>
  /**
   * Transform notification to the request body.
   * Default: sends `{ subject, message, to, priority, data }`
   */
  transform?: (notification: Notification) => any
}

/**
 * Webhook notification channel — POST notifications to any URL.
 * Works with Slack incoming webhooks, Discord webhooks, custom APIs, etc.
 *
 * @example
 * ```ts
 * // Generic webhook
 * new WebhookChannel({ url: 'https://hooks.example.com/notify' })
 *
 * // Slack incoming webhook
 * new WebhookChannel({
 *   url: process.env.SLACK_WEBHOOK_URL!,
 *   transform: (n) => ({
 *     text: `*${n.subject}*\n${n.message}`,
 *   }),
 * })
 *
 * // Discord webhook
 * new WebhookChannel({
 *   url: process.env.DISCORD_WEBHOOK_URL!,
 *   transform: (n) => ({
 *     content: `**${n.subject}**\n${n.message}`,
 *   }),
 * })
 * ```
 */
export class WebhookChannel implements NotificationChannel {
  name = 'webhook'
  private options: WebhookChannelOptions

  constructor(options: WebhookChannelOptions) {
    this.options = options
  }

  async send(notification: Notification): Promise<void> {
    const body = this.options.transform
      ? this.options.transform(notification)
      : {
          subject: notification.subject,
          message: notification.message,
          to: notification.to,
          priority: notification.priority,
          data: notification.data,
        }

    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`)
    }
  }
}

/**
 * Slack-specific webhook channel with pre-configured transform.
 *
 * @example
 * ```ts
 * new SlackChannel({ url: process.env.SLACK_WEBHOOK_URL! })
 * ```
 */
export class SlackChannel extends WebhookChannel {
  constructor(options: { url: string; channel?: string }) {
    super({
      url: options.url,
      transform: (n) => ({
        ...(options.channel ? { channel: options.channel } : {}),
        text: `*${n.subject}*\n${n.message}`,
        ...(n.priority === 'urgent' || n.priority === 'high'
          ? { attachments: [{ color: '#ff0000', text: n.message }] }
          : {}),
      }),
    })
    this.name = 'slack'
  }
}

/**
 * Discord-specific webhook channel.
 *
 * @example
 * ```ts
 * new DiscordChannel({ url: process.env.DISCORD_WEBHOOK_URL! })
 * ```
 */
export class DiscordChannel extends WebhookChannel {
  constructor(options: { url: string }) {
    super({
      url: options.url,
      transform: (n) => ({
        content: `**${n.subject}**\n${n.message}`,
      }),
    })
    this.name = 'discord'
  }
}
