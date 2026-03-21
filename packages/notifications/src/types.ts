// ── Notification Channel Interface ──────────────────────────────────────

/**
 * Abstract notification channel. Implement this to send notifications
 * via any medium: email, Slack, Discord, webhook, SMS, push, etc.
 *
 * @example
 * ```ts
 * class SlackChannel implements NotificationChannel {
 *   name = 'slack'
 *   async send(notification) {
 *     await fetch(this.webhookUrl, {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ text: notification.message }),
 *     })
 *   }
 * }
 * ```
 */
export interface NotificationChannel {
  /** Channel name for routing */
  name: string

  /** Send a notification through this channel */
  send(notification: Notification): Promise<void>
}

// ── Notification ────────────────────────────────────────────────────────

export interface Notification {
  /** Recipient identifier (email, user ID, channel name, etc.) */
  to: string | string[]

  /** Notification subject/title */
  subject: string

  /** Plain text message */
  message: string

  /** HTML message (for email channels) */
  html?: string

  /** Which channels to send through (defaults to all) */
  channels?: string[]

  /** Additional data for channel-specific formatting */
  data?: Record<string, any>

  /** Priority level */
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

export interface NotificationResult {
  channel: string
  success: boolean
  error?: string
}

// ── Notification Service Options ────────────────────────────────────────

export interface NotificationServiceOptions {
  /** Notification channels to register */
  channels: NotificationChannel[]

  /** Default channels to use when notification.channels is not specified */
  defaultChannels?: string[]
}
