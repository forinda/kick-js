# Notifications (BYO)

KickJS doesn't ship a first-party notifications package — the previous one was 47 lines of DI glue around a `Notifier` interface. This guide shows how to wire your channel mix (Slack, Discord, email, webhook, in-app, push…) via a `definePlugin` factory.

## Define the contract

```ts
// src/services/notifier.ts
export interface Notification {
  channel: 'slack' | 'discord' | 'email' | 'webhook'
  to: string
  subject?: string
  body: string
  metadata?: Record<string, unknown>
}

export interface Notifier {
  send(notification: Notification): Promise<void>
}

export const NOTIFIER = createToken<Notifier>('app/notifier')
```

## Implement channels

Inline whichever channels you actually use; they all wrap a third-party SDK or `fetch`:

```ts
// src/services/channels/slack.channel.ts
import type { Notification } from '../notifier'

export async function sendSlack(webhook: string, n: Notification) {
  await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: n.body }),
  })
}
```

```ts
// src/services/channels/email.channel.ts
import type { Notification } from '../notifier'
import { MailerService } from '../mailer.service'

export async function sendEmail(mailer: MailerService, n: Notification) {
  await mailer.send({ to: n.to, subject: n.subject ?? '', html: n.body })
}
```

## Compose into a Notifier and register

```ts
// src/plugins/notifications.plugin.ts
import { definePlugin, type Container } from '@forinda/kickjs'
import { MailerService } from '../services/mailer.service'
import { NOTIFIER, type Notifier } from '../services/notifier'
import { sendSlack } from '../services/channels/slack.channel'
import { sendEmail } from '../services/channels/email.channel'

export interface NotificationsConfig {
  slackWebhook?: string
}

export const NotificationsPlugin = definePlugin<NotificationsConfig>({
  name: 'NotificationsPlugin',
  build: (config) => ({
    register(container: Container) {
      container.registerFactory(
        NOTIFIER,
        () => {
          const mailer = container.resolve(MailerService)
          const notifier: Notifier = {
            async send(n) {
              switch (n.channel) {
                case 'slack':
                  if (!config.slackWebhook) throw new Error('Slack webhook not configured')
                  return sendSlack(config.slackWebhook, n)
                case 'email':
                  return sendEmail(mailer, n)
                default:
                  throw new Error(`Channel not implemented: ${n.channel}`)
              }
            },
          }
          return notifier
        },
      )
    },
  }),
})
```

## Usage

```ts
@Service()
export class OrderService {
  constructor(@Inject(NOTIFIER) private notifier: Notifier) {}

  async confirm(order: Order) {
    await this.notifier.send({
      channel: 'email',
      to: order.email,
      subject: 'Order confirmed',
      body: `<p>Your order #${order.id} is confirmed.</p>`,
    })
  }
}
```

## DevTools integration

Surface delivery counters per channel on the DevTools dashboard via the `introspect()` slot on a wrapping adapter:

```ts
import { defineAdapter } from '@forinda/kickjs'
import type { IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'
import { NOTIFIER, type Notifier } from '../services/notifier'

export const NotificationsObservabilityAdapter = defineAdapter({
  name: 'NotificationsObservabilityAdapter',
  build: () => {
    const sent: Record<string, number> = {}
    const failed: Record<string, number> = {}

    return {
      beforeStart({ container }) {
        const notifier = container.resolve(NOTIFIER)
        const original = notifier.send.bind(notifier)
        notifier.send = async (n) => {
          try {
            await original(n)
            sent[n.channel] = (sent[n.channel] ?? 0) + 1
          } catch (err) {
            failed[n.channel] = (failed[n.channel] ?? 0) + 1
            throw err
          }
        }
      },

      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: 1,
          name: 'NotificationsObservabilityAdapter',
          kind: 'adapter',
          state: { sent, failed },
          metrics: {
            totalSent: Object.values(sent).reduce((s, n) => s + n, 0),
            totalFailed: Object.values(failed).reduce((s, n) => s + n, 0),
          },
        }
      },
    }
  },
})
```

Mount alongside `NotificationsPlugin()`. The topology view shows per-channel `sent` / `failed` counts live.

## What you give up by going BYO

The previous `@forinda/kickjs-notifications` package added a single `NotificationsAdapter` factory that wired the same DI registration. Everything else (channel implementations, fan-out, retry, dead-letter handling) was up to you. The recipe above is the entire wrapper inlined into your app — pick the channels you actually need and you're done.

## Related

- [Plugins](./plugins.md)
- [Dependency Injection](./dependency-injection.md)
- [Mailers](./mailer.md) — paired pattern for the email channel
