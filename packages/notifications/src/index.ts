import 'reflect-metadata'

// Types
export {
  type NotificationChannel,
  type Notification,
  type NotificationResult,
  type NotificationServiceOptions,
} from './types'

// Service
export { NotificationService, NOTIFICATIONS } from './service'

// Adapter
export { NotificationAdapter } from './adapter'

// Built-in channels
export {
  WebhookChannel,
  SlackChannel,
  DiscordChannel,
  EmailChannel,
  ConsoleChannel,
  type WebhookChannelOptions,
} from './channels'
