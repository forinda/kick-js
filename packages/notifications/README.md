# @forinda/kickjs-notifications

Multi-channel notifications for KickJS — email, Slack, Discord, webhook, console, plus a pluggable `NotificationChannel` interface for custom transports.

## Install

```bash
kick add notifications
```

## Quick Example

```ts
import { bootstrap, getEnv, Inject, Service } from '@forinda/kickjs'
import {
  NotificationAdapter,
  NotificationService,
  SlackChannel,
  ConsoleChannel,
  NOTIFICATIONS,
} from '@forinda/kickjs-notifications'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    NotificationAdapter({
      channels: [
        new SlackChannel({ webhookUrl: getEnv('SLACK_WEBHOOK') }),
        new ConsoleChannel(),
      ],
    }),
  ],
})

@Service()
class AlertService {
  constructor(@Inject(NOTIFICATIONS) private notifications: NotificationService) {}

  alertTeam(message: string) {
    return this.notifications.send({ channels: ['slack'], subject: 'Alert', body: message })
  }
}
```

## Documentation

[forinda.github.io/kick-js/api/notifications](https://forinda.github.io/kick-js/api/notifications)

## License

MIT
