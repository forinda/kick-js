# Mailer

KickJS provides pluggable email sending through `@forinda/kickjs-mailer`. Implement the `MailProvider` interface to use any email service — SMTP, Resend, AWS SES, SendGrid, Postmark, or your own.

## Installation

```bash
pnpm add @forinda/kickjs-mailer

# For SMTP (nodemailer)
pnpm add nodemailer @types/nodemailer
```

Or via CLI:

```bash
kick add mailer
```

## Quick Start

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { MailerAdapter, SmtpProvider } from '@forinda/kickjs-mailer'

bootstrap({
  modules: [...],
  adapters: [
    MailerAdapter({
      provider: new SmtpProvider({
        host: 'smtp.gmail.com',
        port: 587,
        auth: { user: getEnv('SMTP_USER'), pass: getEnv('SMTP_PASS') },
      }),
      defaultFrom: { name: 'My App', address: 'noreply@myapp.com' },
    }),
  ],
})
```

Then inject `MailerService` anywhere:

```ts
import { Service, Inject } from '@forinda/kickjs'
import { MAILER, type MailerService } from '@forinda/kickjs-mailer'

@Service()
class UserService {
  constructor(@Inject(MAILER) private mailer: MailerService) {}

  async sendWelcome(email: string, name: string) {
    await this.mailer.send({
      to: email,
      subject: 'Welcome!',
      html: `<h1>Hello ${name}</h1><p>Welcome to our platform.</p>`,
    })
  }
}
```

## Built-in Providers

### SmtpProvider

SMTP via nodemailer. Works with any SMTP server.

```ts
// Gmail
new SmtpProvider({
  host: 'smtp.gmail.com',
  port: 587,
  auth: { user: 'you@gmail.com', pass: 'app-password' },
})

// Resend via SMTP
new SmtpProvider({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: { user: 'resend', pass: getEnv('RESEND_API_KEY') },
})

// Local dev (Mailpit, MailHog)
new SmtpProvider({ host: 'localhost', port: 1025 })
```

### ConsoleProvider

Logs emails to the console — perfect for development.

```ts
import { ConsoleProvider } from '@forinda/kickjs-mailer'

MailerAdapter({
  provider: new ConsoleProvider(),
  defaultFrom: 'dev@localhost',
})
```

## Custom Provider

Implement `MailProvider` for any email service:

```ts
import type { MailProvider, MailMessage, MailResult } from '@forinda/kickjs-mailer'
import { Resend } from 'resend'

class ResendProvider implements MailProvider {
  name = 'resend'
  private client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(message: MailMessage): Promise<MailResult> {
    const { data, error } = await this.client.emails.send({
      from: formatAddress(message.from),
      to: Array.isArray(message.to)
        ? message.to.map(r => typeof r === 'string' ? r : r.address)
        : [typeof message.to === 'string' ? message.to : message.to.address],
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (error) throw error
    return { messageId: data!.id, accepted: true, raw: data }
  }
}

// Use it
MailerAdapter({
  provider: new ResendProvider(getEnv('RESEND_API_KEY')),
})
```

### MailProvider Interface

```ts
interface MailProvider {
  name: string
  send(message: MailMessage): Promise<MailResult>
  shutdown?(): Promise<void>
}
```

## Templates

Configure a template engine for rendering HTML emails:

```ts
import Handlebars from 'handlebars'
import type { MailTemplateEngine } from '@forinda/kickjs-mailer'

class HandlebarsEngine implements MailTemplateEngine {
  private templates = new Map<string, HandlebarsTemplateDelegate>()

  register(name: string, source: string) {
    this.templates.set(name, Handlebars.compile(source))
  }

  render(template: string, data: Record<string, any>): string {
    const fn = this.templates.get(template)
    if (!fn) throw new Error(`Template "${template}" not found`)
    return fn(data)
  }
}

const engine = new HandlebarsEngine()
engine.register('welcome', '<h1>Welcome {{name}}</h1><p>Your account is ready.</p>')
engine.register('invoice', '<h1>Invoice #{{number}}</h1><p>Total: ${{total}}</p>')

MailerAdapter({
  provider: new SmtpProvider({ ... }),
  templateEngine: engine,
})

// Then in your service:
await this.mailer.sendTemplate('welcome', {
  to: user.email,
  subject: 'Welcome!',
}, { name: user.name })
```

## Mail Message

```ts
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
  metadata?: Record<string, any>   // provider-specific options
}

type MailRecipient = string | { name?: string; address: string }
```

## Disable for Testing

```ts
MailerAdapter({
  provider: new SmtpProvider({ ... }),
  enabled: getEnv('NODE_ENV') !== 'test', // logs instead of sending
})
```
