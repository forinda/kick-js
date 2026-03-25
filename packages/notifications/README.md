# @forinda/kickjs-notifications

Multi-channel notifications for KickJS — email, Slack, Discord, webhook, and custom channels.

## Install

```bash
# Using the KickJS CLI (recommended)
kick add notifications

# Manual install
pnpm add @forinda/kickjs-notifications
```

## Features

- `NotificationAdapter` — lifecycle adapter that registers the notification service
- `NotificationService` — injectable service for dispatching notifications
- Built-in channels: `EmailChannel`, `SlackChannel`, `DiscordChannel`, `WebhookChannel`, `ConsoleChannel`
- `NOTIFICATIONS` token for DI injection
- Pluggable `NotificationChannel` interface for custom transports

## Quick Example

```typescript
import {
  NotificationAdapter,
  NotificationService,
  SlackChannel,
  EmailChannel,
  ConsoleChannel,
  NOTIFICATIONS,
} from '@forinda/kickjs-notifications'
import { Inject, Service } from '@forinda/kickjs-core'

bootstrap({
  modules,
  adapters: [
    new NotificationAdapter({
      channels: [
        new SlackChannel({ webhookUrl: process.env.SLACK_WEBHOOK! }),
        new EmailChannel({ mailer }),
        new ConsoleChannel(),
      ],
    }),
  ],
})

// Send notifications from any service
@Service()
class AlertService {
  @Inject(NOTIFICATIONS) private notifications!: NotificationService

  async alertTeam(message: string) {
    await this.notifications.send({
      channels: ['slack', 'email'],
      subject: 'Alert',
      body: message,
      to: 'team@example.com',
    })
  }
}
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
