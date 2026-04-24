# Mailers (BYO)

KickJS doesn't ship a first-party mailer package — the previous wrapper was 70 lines of DI registration around a provider interface adopters consistently swapped for direct upstream usage. This guide shows how to wire your mailer of choice via a `definePlugin` factory.

::: tip Pick any provider
The recipe below uses [`nodemailer`](https://nodemailer.com/) (works with SMTP, SES, Mailgun, Mailtrap…). Swap in [Resend](https://resend.com/), AWS SES SDK, SendGrid, Postmark, or anything else with an async `send(message)` API.
:::

## Setup

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

## Service + DI plugin

```ts
// src/services/mailer.service.ts
import nodemailer, { type Transporter } from 'nodemailer'
import { Service } from '@forinda/kickjs'

export interface MailMessage {
  to: string
  subject: string
  html?: string
  text?: string
}

@Service()
export class MailerService {
  constructor(private readonly transporter: Transporter, private readonly defaultFrom: string) {}

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.defaultFrom, ...message })
  }
}

export interface MailerConfig {
  smtpUrl: string         // e.g. 'smtps://user:pass@smtp.example.com:465'
  defaultFrom: string     // e.g. 'noreply@example.com'
}

export function buildMailer(config: MailerConfig): MailerService {
  const transporter = nodemailer.createTransport(config.smtpUrl)
  return new MailerService(transporter, config.defaultFrom)
}
```

```ts
// src/plugins/mailer.plugin.ts
import { definePlugin } from '@forinda/kickjs'
import { buildMailer, MailerService, type MailerConfig } from '../services/mailer.service'

export const MailerPlugin = definePlugin<MailerConfig>({
  name: 'MailerPlugin',
  build: (config) => ({
    register(container) {
      // One transporter per process; share it across every consumer.
      container.registerInstance(MailerService, buildMailer(config))
    },
  }),
})
```

## Usage

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { MailerPlugin } from './plugins/mailer.plugin'

export const app = await bootstrap({
  modules,
  plugins: [
    MailerPlugin({
      smtpUrl: process.env.SMTP_URL!,
      defaultFrom: 'noreply@example.com',
    }),
  ],
})
```

```ts
// In any service / controller
@Service()
export class WelcomeEmail {
  constructor(private mailer: MailerService) {}

  async sendTo(user: { email: string; name: string }) {
    await this.mailer.send({
      to: user.email,
      subject: 'Welcome',
      html: `<p>Hi ${user.name}, welcome aboard.</p>`,
    })
  }
}
```

## Worked example: Console mailer driven by the Asset Manager

A drop-in dev provider that doesn't actually send mail — it renders templates from `assetMap` and prints them to the console. Useful for local development and tests, and a good demonstration of how the [Asset Manager](./asset-manager.md) keeps templates typed without runtime imports.

### 1. Wire the asset map

Drop your templates anywhere and point `assetMap` at it in `kick.config.ts`:

```ts
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  assetMap: {
    mails: { src: 'src/templates/mails' },
  },
})
```

```
src/templates/mails/
├── welcome.txt
├── password-reset.txt
└── order-confirmation.txt
```

```text
// src/templates/mails/welcome.txt
Hi {{ name }},

Welcome to {{ appName }}! Your account is ready.

— The team
```

`kick dev` regenerates `KickAssets` automatically as files come and go — `assets.mails.welcome` becomes a typed string-literal key.

### 2. Console mailer service

```ts
// src/services/console-mailer.service.ts
import { readFile } from 'node:fs/promises'
import { Service, useAssets } from '@forinda/kickjs'
import type { MailMessage } from './notifier'

export interface MailProvider {
  send(message: MailMessage & { template?: string; data?: Record<string, unknown> }): Promise<void>
}

@Service()
export class ConsoleMailer implements MailProvider {
  // `useAssets()` returns the typed Proxy. After typegen runs,
  // `assets.mails.welcome` is a `KickAssets['mails']['welcome']`
  // string literal that resolves to an absolute file path at read time.
  private assets = useAssets()

  async send(message: MailMessage & { template?: string; data?: Record<string, unknown> }) {
    const body = message.template
      ? await this.render(message.template, message.data ?? {})
      : (message.html ?? message.text ?? '')

    console.log('━'.repeat(60))
    console.log(`📨 ${message.subject ?? '(no subject)'}`)
    console.log(`To: ${message.to}`)
    console.log('─'.repeat(60))
    console.log(body)
    console.log('━'.repeat(60))
  }

  /**
   * Render a template by reading the file the asset manager points
   * at, then doing a tiny `{{ var }}` substitution. Swap in eta /
   * Handlebars / Mustache for anything beyond toy interpolation.
   *
   * The dev-mode asset resolver doesn't cache, so editing
   * `src/templates/mails/welcome.txt` and saving lands in the next
   * call without a server restart.
   */
  private async render(name: string, data: Record<string, unknown>): Promise<string> {
    // `(this.assets as any).mails[name]` because `name` is a runtime
    // string here — the typed surface is on direct property access
    // (`this.assets.mails.welcome`). Use the typed form whenever you
    // know the key at compile time.
    const filePath = (this.assets as any).mails[name] as string
    const raw = await readFile(filePath, 'utf-8')
    return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => String(data[k] ?? ''))
  }
}
```

### 3. Plugin registration

```ts
// src/plugins/console-mailer.plugin.ts
import { definePlugin } from '@forinda/kickjs'
import { ConsoleMailer } from '../services/console-mailer.service'

export const ConsoleMailerPlugin = definePlugin({
  name: 'ConsoleMailerPlugin',
  build: () => ({
    register(container) {
      container.registerInstance(ConsoleMailer, new ConsoleMailer())
    },
  }),
})
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { ConsoleMailerPlugin } from './plugins/console-mailer.plugin'

export const app = await bootstrap({
  modules,
  plugins: [ConsoleMailerPlugin()],
})
```

### 4. Use it (typed template names)

```ts
@Service()
export class WelcomeFlow {
  constructor(private mailer: ConsoleMailer) {}

  async greet(user: { email: string; name: string }) {
    await this.mailer.send({
      to: user.email,
      subject: 'Welcome',
      template: 'welcome',
      data: { name: user.name, appName: 'Acme' },
    })
  }
}
```

The output:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 Welcome
To: alice@example.com
────────────────────────────────────────────────────────────
Hi Alice,

Welcome to Acme! Your account is ready.

— The team
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Swapping in a real provider for production

`ConsoleMailer` and a real `NodeMailerProvider` both implement the same `MailProvider` interface. Bind by environment in the plugin:

```ts
build: (config) => ({
  register(container) {
    container.registerInstance(
      MAILER,
      process.env.NODE_ENV === 'production'
        ? new NodeMailerProvider(config.smtpUrl)
        : new ConsoleMailer(),
    )
  },
}),
```

Now `pnpm dev` shows mails in your terminal; `pnpm start` posts them through SMTP. Same template files, same call sites — only the binding flips.

## Pluggable providers

The `MailerService` above hard-codes nodemailer. To support multiple providers (Resend, SES) without forking the service, wrap them in a common interface:

```ts
export interface MailProvider {
  send(message: MailMessage): Promise<void>
}

class NodeMailerProvider implements MailProvider { /* ... */ }
class ResendProvider implements MailProvider { /* ... */ }
```

Then `MailerService` constructor accepts a `MailProvider` instead of a raw transporter, and `MailerPlugin` builds the right provider based on a `provider: 'smtp' | 'resend'` config field.

## DevTools integration

Surface delivery counters on the DevTools dashboard via the `introspect()` slot on a wrapping adapter (since this recipe uses a plugin for DI registration, the metrics live on the adapter for the topology view):

```ts
import { defineAdapter } from '@forinda/kickjs'
import type { IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'
import { MailerService } from '../services/mailer.service'

export const MailerObservabilityAdapter = defineAdapter({
  name: 'MailerObservabilityAdapter',
  build: () => {
    let sent = 0
    let failed = 0

    return {
      beforeStart({ container }) {
        const mailer = container.resolve(MailerService)
        const original = mailer.send.bind(mailer)
        mailer.send = async (msg) => {
          try {
            await original(msg)
            sent++
          } catch (err) {
            failed++
            throw err
          }
        }
      },

      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: 1,
          name: 'MailerObservabilityAdapter',
          kind: 'adapter',
          metrics: { sent, failed },
        }
      },
    }
  },
})
```

Mount alongside `MailerPlugin()`. The DevTools topology view shows `sent` / `failed` counters live.

## What you give up by going BYO

The previous `@forinda/kickjs-mailer` package added:

1. **Built-in provider classes** for SMTP, Resend, SendGrid, SES, and a Console provider for dev — all 30-50 lines each. Inline the ones you actually use; pull from the package's [archived source](https://github.com/forinda/kick-js/tree/main/packages/mailer/src/providers) if you want a starting point.
2. **A `MailTemplateEngine` interface** for rendering MJML / Handlebars templates. Most adopters use [react-email](https://react.email/) or inline templates today; wire whichever via your `MailerService.send` body.

Everything else was DI registration.

## Related

- [Plugins](./plugins.md) — `definePlugin` factory reference
- [DI](./dependency-injection.md) — `@Service` + `@Autowired` patterns
- [nodemailer docs](https://nodemailer.com/)
