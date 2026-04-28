# Scheduled Tasks (BYO Cron)

KickJS doesn't ship a first-party cron package — scheduling libraries are tiny, opinionated, and adopters consistently swap the wrapper for direct upstream usage. This guide shows how to mount **your own** cron adapter using `defineAdapter` plus a scheduling library of your choice.

::: tip Pick any scheduler
The recipe below uses [`croner`](https://github.com/Hexagon/croner) (zero deps, tiny, supports timezones). Swap in `node-cron`, `cron`, `node-schedule`, or raw `setInterval` — only the line that constructs the timer changes.
:::

## Setup

```bash
pnpm add croner
```

## Decorator + adapter

::: tip Use the framework's metadata helpers, not raw `Reflect`
KickJS exports `setClassMeta` / `pushClassMeta` / `getClassMeta` / `getMethodMeta` from `@forinda/kickjs`. They wrap `Reflect.defineMetadata` / `Reflect.getMetadata` with typed returns, sensible defaults, and the framework's `'kick/<area>/<key>'` key convention. Use them in adopter code so your decorator metadata round-trips through the same store the framework uses (DevTools introspection, typegen, etc. can pick it up). Don't import `reflect-metadata` directly — the framework already does at startup.
:::

```ts
// src/decorators/cron.decorator.ts
import { pushClassMeta, getClassMeta } from '@forinda/kickjs'

const CRON_META = 'app/cron'   // adopter scope — first-party would be 'kick/cron'

export interface CronJobMeta {
  expression: string
  handlerName: string
  description?: string
  timezone?: string
  runOnInit?: boolean
}

export function Cron(
  expression: string,
  options?: { description?: string; timezone?: string; runOnInit?: boolean },
): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<CronJobMeta>(CRON_META, target.constructor, {
      expression,
      handlerName: propertyKey as string,
      description: options?.description,
      timezone: options?.timezone,
      runOnInit: options?.runOnInit,
    })
  }
}

export function getCronJobs(target: object): CronJobMeta[] {
  return getClassMeta<CronJobMeta[]>(CRON_META, target, [])
}
```

```ts
// src/adapters/cron.adapter.ts
import { Cron as CronJob } from 'croner'
import { Logger, defineAdapter, type AdapterContext, type Constructor } from '@forinda/kickjs'
import { getCronJobs } from '../decorators/cron.decorator'

const log = Logger.for('CronAdapter')

export interface CronAdapterOptions {
  /** Service classes containing `@Cron`-decorated methods. */
  services: Constructor[]
  /** Disable all scheduled jobs (e.g. on a worker process that shouldn't run cron). */
  enabled?: boolean
}

export const CronAdapter = defineAdapter<CronAdapterOptions>({
  name: 'CronAdapter',
  defaults: { enabled: true },
  build: (config) => {
    const jobs: CronJob[] = []

    return {
      async beforeStart({ container }: AdapterContext) {
        if (!config.enabled) return

        for (const ServiceClass of config.services) {
          const instance = container.resolve(ServiceClass)
          for (const meta of getCronJobs(ServiceClass)) {
            const job = new CronJob(
              meta.expression,
              { timezone: meta.timezone },
              async () => {
                try {
                  await instance[meta.handlerName]()
                } catch (err) {
                  log.error(err as Error, `Cron job ${ServiceClass.name}.${meta.handlerName} failed`)
                }
              },
            )
            jobs.push(job)
            log.info(`Scheduled ${ServiceClass.name}.${meta.handlerName} (${meta.expression})`)
            if (meta.runOnInit) instance[meta.handlerName]().catch(() => {})
          }
        }
      },

      async shutdown() {
        for (const job of jobs) job.stop()
        log.info(`Stopped ${jobs.length} cron job(s)`)
      },
    }
  },
})
```

## Usage

```ts
// src/services/cleanup.service.ts
import { Service } from '@forinda/kickjs'
import { Cron } from '../decorators/cron.decorator'

@Service()
export class CleanupService {
  @Cron('0 2 * * *', { description: 'Daily DB vacuum at 2am' })
  async vacuum() {
    // ...
  }

  @Cron('*/5 * * * *', { runOnInit: true })
  async heartbeat() {
    // ...
  }
}
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { CronAdapter } from './adapters/cron.adapter'
import { CleanupService } from './services/cleanup.service'

export const app = await bootstrap({
  modules,
  adapters: [CronAdapter({ services: [CleanupService] })],
})
```

## DevTools integration

Even with the BYO adapter you keep the DevTools dashboard. Implement the optional `introspect()` and `devtoolsTabs()` slots `defineAdapter()` exposes — DevTools auto-discovers them and surfaces the data without any further wiring:

```ts
import { defineAdapter } from '@forinda/kickjs'
import type { IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'
import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'

export const CronAdapter = defineAdapter<CronAdapterOptions>({
  name: 'CronAdapter',
  build: (config) => {
    const jobs: { name: string; expression: string; running: boolean; lastRunMs?: number }[] = []
    let runs = 0
    let failures = 0

    return {
      // ... beforeStart / shutdown as above, but record metrics in the
      // closures: `jobs.push(...)`, `runs++`, `failures++ on catch`.

      /** DevTools polls this on the topology endpoint — keep it cheap. */
      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: 1,
          name: 'CronAdapter',
          kind: 'adapter',
          state: { jobs },
          metrics: {
            scheduled: jobs.length,
            running: jobs.filter((j) => j.running).length,
            runs,
            failures,
          },
        }
      },

      /** Optional dedicated tab in the DevTools sidebar. */
      devtoolsTabs() {
        return [
          defineDevtoolsTab({
            id: 'cron',
            title: 'Cron',
            icon: 'mdi:clock-outline',
            category: 'observability',
            view: {
              type: 'launch',
              actions: jobs.map((j) => ({
                id: `run:${j.name}`,
                label: `Run ${j.name} now`,
                description: j.expression,
              })),
            },
          }),
        ]
      },
    }
  },
})
```

`introspect()` is for the topology view (numbers + small JSON state). `devtoolsTabs()` ships a dedicated panel — three view types: `iframe` (embed your own URL), `launch` (button list that POSTs to your handlers), `html` (trusted inline string). See `@forinda/kickjs-devtools-kit` for the full type surface.

## What you give up by going BYO

The previous `@forinda/kickjs-cron` package added two niceties on top of this recipe:

1. **`croner` was an optional peer dep** with a `setInterval` fallback — keep this if you care; branch on `try { require('croner') } catch { fallback }`.
2. **DevTools panel was pre-wired** — the `introspect()` / `devtoolsTabs()` recipe above gives you the same panel back in ~20 lines.

Everything else was thin glue.

## Related

- [Adapters](./adapters.md) — `defineAdapter` factory reference
- [Custom Decorators](./custom-decorators.md)
- [croner docs](https://github.com/Hexagon/croner)
