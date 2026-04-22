# @forinda/kickjs-mailer

Pluggable email for KickJS — SMTP (`nodemailer`), Resend, SES, Console (dev), or any custom `MailProvider`.

## Install

```bash
kick add mailer
```

## Quick Example

```ts
import { bootstrap, getEnv, Inject, Service } from '@forinda/kickjs'
import { MailerAdapter, SmtpProvider, ConsoleProvider, MAILER, type MailerService } from '@forinda/kickjs-mailer'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    MailerAdapter({
      provider: getEnv('NODE_ENV') === 'production'
        ? new SmtpProvider({
            host: 'smtp.example.com',
            port: 587,
            auth: { user: getEnv('SMTP_USER'), pass: getEnv('SMTP_PASS') },
          })
        : new ConsoleProvider(),
    }),
  ],
})

@Service()
class NotifyService {
  constructor(@Inject(MAILER) private mailer: MailerService) {}

  sendWelcome(to: string) {
    return this.mailer.send({ to, subject: 'Welcome', html: '<h1>Welcome</h1>' })
  }
}
```

## Documentation

[forinda.github.io/kick-js/guide/mailer](https://forinda.github.io/kick-js/guide/mailer)

## License

MIT
