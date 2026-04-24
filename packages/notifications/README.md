# @forinda/kickjs-notifications

> [!WARNING] Deprecated — going private in v4.1.2.
> This package is being retired. The replacement is a short BYO recipe using `defineAdapter` / `definePlugin` from `@forinda/kickjs` directly — see **[guide/notifications](https://forinda.github.io/kick-js/guide/notifications)** for the copy-paste alternative.
>
> The package still works in v4.1.x; v4.1.2 will remove it from the public registry. Migrate at your convenience.

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
