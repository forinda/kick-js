# @forinda/kickjs-mailer

Pluggable email sending for KickJS — SMTP, Resend, SES, and custom providers.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add mailer

# Manual install
pnpm add @forinda/kickjs-mailer nodemailer
```

## Features

- `MailerAdapter` — lifecycle adapter that registers the mailer in DI
- `MailerService` — injectable service for sending email
- Built-in providers: `SmtpProvider` (nodemailer), `ConsoleProvider` (dev logging)
- `MAILER` token for DI injection
- Pluggable `MailProvider` interface for custom transports (Resend, SES, etc.)

## Quick Example

```typescript
import { MailerAdapter, SmtpProvider, ConsoleProvider } from '@forinda/kickjs-mailer'

bootstrap({
  modules,
  adapters: [
    new MailerAdapter({
      provider: process.env.NODE_ENV === 'production'
        ? new SmtpProvider({ host: 'smtp.example.com', port: 587, auth: { user: '...', pass: '...' } })
        : new ConsoleProvider(),
    }),
  ],
})

// In a service
@Service()
class NotifyService {
  @Inject(MAILER) private mailer!: MailerService

  async sendWelcome(email: string) {
    await this.mailer.send({
      to: email,
      subject: 'Welcome!',
      html: '<h1>Welcome to our app</h1>',
    })
  }
}
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/mailer)

## License

MIT
