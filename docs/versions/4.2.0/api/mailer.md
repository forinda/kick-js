# @forinda/kickjs-mailer

Pluggable email sending with template support.

## MailProvider

```typescript
interface MailProvider {
  name: string
  send(message: MailMessage): Promise<MailResult>
  shutdown?(): Promise<void>
}
```

## MailMessage

```typescript
interface MailMessage {
  from?: MailRecipient
  to: MailRecipient | MailRecipient[]
  cc?: MailRecipient | MailRecipient[]
  bcc?: MailRecipient | MailRecipient[]
  replyTo?: MailRecipient
  subject: string
  text?: string
  html?: string
  attachments?: MailAttachment[]
  headers?: Record<string, string>
  metadata?: Record<string, any>
}

type MailRecipient = string | MailAddress
interface MailAddress { name?: string; address: string }
interface MailAttachment {
  filename: string
  content?: string | Buffer
  path?: string
  contentType?: string
}
```

## MailResult

```typescript
interface MailResult {
  messageId: string
  accepted: boolean
  raw?: any
}
```

## MailTemplateEngine

```typescript
interface MailTemplateEngine {
  render(template: string, data: Record<string, any>): Promise<string> | string
}
```

## MailerService

```typescript
class MailerService {
  constructor(options: MailerOptions)
  send(message: MailMessage): Promise<MailResult>
  sendTemplate(template: string, message: Omit<MailMessage, 'html'>, data: Record<string, any>): Promise<MailResult>
  getProvider(): MailProvider
  shutdown(): Promise<void>
}

const MAILER: symbol // DI token
```

## MailerAdapter

```typescript
const MailerAdapter: AdapterFactory<MailerOptions>

interface MailerOptions {
  provider: MailProvider
  defaultFrom?: MailRecipient
  templateEngine?: MailTemplateEngine
  enabled?: boolean
}
```

Built with `defineAdapter()` — call it as `MailerAdapter({ provider, … })` and pass the result to `bootstrap({ adapters: [...] })`.

## SmtpProvider

```typescript
class SmtpProvider implements MailProvider {
  name = 'smtp'
  constructor(options: SmtpOptions)
}

interface SmtpOptions {
  host: string
  port?: number
  secure?: boolean
  auth?: { user: string; pass: string }
  connectionTimeout?: number
}
```

Requires `nodemailer` peer dependency.

## ConsoleProvider

```typescript
class ConsoleProvider implements MailProvider {
  name = 'console'
}
```

Logs emails to stdout. For development/testing.
