import 'reflect-metadata'

// Types
export {
  type MailProvider,
  type MailMessage,
  type MailResult,
  type MailAddress,
  type MailRecipient,
  type MailAttachment,
  type MailTemplateEngine,
  type MailerOptions,
} from './types'

// Service
export { MailerService, MAILER } from './mailer.service'

// Adapter
export { MailerAdapter } from './adapter'

// Built-in providers
export { SmtpProvider, ConsoleProvider, type SmtpOptions } from './providers'
