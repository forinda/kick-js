# Scheduled Tasks

`@Cron` marks a service method as a scheduled job. What runs it depends on where the app is deployed:

| Where                  | What runs the job                                                      |
| ---------------------- | ---------------------------------------------------------------------- |
| Node server            | `KickCronAdapter()` — opt-in, uses the optional peer `croner`          |
| Vercel                 | a Vercel cron that `kick build:vercel` writes, calling the app         |
| Cloudflare Workers     | the web entry's `scheduled()` handler                                  |
| Netlify                | nothing — `kick build:netlify` warns (use Netlify scheduled functions) |
| Your own adapter (BYO) | whatever you write — `@Cron` only records metadata                     |

## Declare a job

```ts
import { Cron, Service, type CronRun } from '@forinda/kickjs'

@Service()
export class ReportJobs {
  @Cron('0 2 * * *', { name: 'nightly-vacuum', description: 'Daily DB vacuum at 2am' })
  async vacuum() {
    // ...
  }

  @Cron('*/15 * * * *', { meta: { batch: 500 } })
  async sendDigests(run: CronRun<{ batch: number }>) {
    await this.mailer.flush(run.meta.batch)
  }
}
```

The class must be resolvable from the container (`@Service()` in a module), so jobs get the same singletons requests do.

### Options

| Option        | Default            | What it does                                                                                 |
| ------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `name`        | `ClassName.method` | Stable name for logs, error reports and `runCronJobs({ name })`                              |
| `description` | —                  | Label for logs and DevTools                                                                  |
| `timezone`    | server time        | IANA zone (`'Africa/Nairobi'`). Node runner and Workers only — Vercel crons are UTC          |
| `runOnInit`   | `false`            | Node runner: run once at startup, before the first tick                                      |
| `overlap`     | `false`            | Allow a run to start while the previous one is still going. Off: a busy tick is skipped      |
| `enabled`     | `true`             | `false`, or a function checked on every tick (`() => process.env.JOBS === 'on'`)             |
| `meta`        | `{}`               | Free-form data: handler arguments (`run.meta`), or anything a custom runner or DevTools read |

### The run context

The handler receives a `CronRun`:

```ts
interface CronRun<Meta> {
  name: string
  expression: string
  meta: Meta
  firedAt: Date
  trigger: 'schedule' | 'init' | 'http' | 'workers' | 'manual'
}
```

A job that throws is logged and reported to the [error observers](./observability.md) with `source: 'cron'` and `context: { job, expression, trigger }`.

## Node server

Install the scheduler and register the adapter once:

<PmCommand add="croner" />

```ts
import { bootstrap, KickCronAdapter } from '@forinda/kickjs'

export const app = await bootstrap({
  modules,
  adapters: [KickCronAdapter()],
})
```

It's opt-in so an app that already schedules `@Cron` jobs with its own adapter doesn't run them twice. It's named `KickCronAdapter` so it never clashes with such an adapter's name or logger.

Jobs stop on shutdown and on every HMR reload, and a reload replaces a class's old jobs rather than adding to them.

**Several processes.** With `bootstrap({ cluster })`, only one worker schedules jobs (the primary sets `KICK_CRON_WORKER=1` on it, and hands the role to its replacement if it dies). Separate instances behind a load balancer each schedule every job: pass `KickCronAdapter({ enabled: false })` on all but one, or have the job take a lock.

## Vercel

`kick build:vercel` reads the `@Cron` decorators in `src/` and writes one Vercel cron per distinct expression into `.vercel/output/config.json`. Each calls `GET /_kick/cron/<id>` on the function, which runs every job on that schedule.

Set `CRON_SECRET` in the Vercel project. Vercel sends it as `Authorization: Bearer $CRON_SECRET`, and the app only mounts the trigger when it's set, rejecting any request without it.

The build warns about what can't be scheduled:

- an expression that isn't a string literal (`@Cron(EVERY_HOUR)`) — the build reads source, it doesn't run it;
- a `timezone` — Vercel crons run in UTC.

The trigger path is fixed at `/_kick/cron/...`, outside `apiPrefix`, so the build and the app always agree on it.

## Cloudflare Workers

`createFetchHandler` returns `scheduled()` beside `fetch`, and runs the jobs whose expression equals the trigger's. List the same expressions in `wrangler.toml`:

```ts
// src/worker.ts
export default createFetchHandler((env) => ({ h3, modules, env }))
```

```toml
[triggers]
crons = ["0 2 * * *", "*/15 * * * *"]
```

The expression must match exactly (whitespace aside) — Workers passes the one it fired for.

## Netlify

Netlify has no cron the build can target, so `@Cron` jobs don't run there, and `kick build:netlify` says so. Use a [Netlify scheduled function](https://docs.netlify.com/build/functions/scheduled-functions/) that calls `runCronJobs`, or deploy the jobs elsewhere.

## Running jobs yourself

```ts
import { Container, runCronJobs } from '@forinda/kickjs'

await runCronJobs(Container.getInstance(), { name: 'nightly-vacuum' }, 'manual')
// → { ran: 1, failed: 0 }
```

Filter by `name`, `scheduleId` or `expression`. It respects `enabled` and `overlap`, and never rejects. `listCronJobs(container)` returns every job with its resolved name and class.

## Bring your own runner

`@Cron` only records metadata, so your own adapter can schedule jobs however it likes. Read them with `listCronJobs`, and run each with `runCronJob` to keep `enabled`, `overlap`, the run context and error reporting:

```ts
import { Cron as Croner } from 'croner'
import { defineAdapter, listCronJobs, runCronJob, type Container } from '@forinda/kickjs'

export const CronAdapter = defineAdapter({
  name: 'CronAdapter',
  build: () => {
    const timers: Croner[] = []
    return {
      afterStart({ container }) {
        for (const job of listCronJobs(container)) {
          timers.push(
            new Croner(job.expression, { timezone: job.timezone }, () =>
              runCronJob(job, container as Container, 'schedule').catch(() => {}),
            ),
          )
        }
      },
      shutdown() {
        for (const timer of timers.splice(0)) timer.stop()
      },
    }
  },
})
```

Add `introspect()` and `devtoolsTabs()` to show the jobs in DevTools — see [Adapters](./adapters.md) and `@forinda/kickjs-devtools-kit`.

## Related

- [Serverless](./serverless.md)
- [Observing Errors and Responses](./observability.md)
- [croner](https://github.com/Hexagon/croner)
