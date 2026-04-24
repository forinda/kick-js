# Cron Jobs

KickJS provides production-grade cron scheduling through the `@forinda/kickjs-cron` package. Decorate service methods with `@Cron`, pick your scheduler backend, and the `CronAdapter` handles the rest.

## Installation

```bash
pnpm add @forinda/kickjs-cron

# For production — install croner (recommended)
pnpm add croner
```

Or via the CLI:

```bash
kick add cron
```

## Quick Start

```ts
import { Service, Cron } from '@forinda/kickjs'
import { CronAdapter } from '@forinda/kickjs-cron'
import { bootstrap } from '@forinda/kickjs'

@Service()
class ReportService {
  @Cron('*/5 * * * *', { description: 'Generate digest' })
  async generateDigest() {
    console.log('Generating digest...')
  }

  @Cron('0 0 * * *', { description: 'Nightly cleanup' })
  async cleanup() {
    console.log('Cleaning up...')
  }
}

bootstrap({
  modules: [...],
  adapters: [
    CronAdapter({ services: [ReportService] }),
  ],
})
```

The adapter auto-detects the best scheduler:
1. **croner** installed → uses `CronerScheduler` (production-grade)
2. No croner → falls back to `IntervalScheduler` (setInterval-based)

## Scheduler Backends

### CronerScheduler (recommended)

Production-grade scheduler powered by [croner](https://www.npmjs.com/package/croner). Zero dependencies, OCPS 1.4 compliant.

Features:
- Full 5/6/7 field cron syntax (with seconds and year)
- Timezone and DST support
- Advanced patterns: `L` (last), `W` (weekday), `#` (nth occurrence)
- Zero timer drift — fires at exact cron boundaries
- Works in Node, Deno, Bun

```ts
import { CronAdapter, CronerScheduler } from '@forinda/kickjs-cron'

CronAdapter({
  services: [ReportService],
  scheduler: new CronerScheduler(),
})
```

### IntervalScheduler (zero-dep fallback)

Lightweight fallback using `setInterval`. No extra dependencies needed.

```ts
import { CronAdapter, IntervalScheduler } from '@forinda/kickjs-cron'

CronAdapter({
  services: [ReportService],
  scheduler: new IntervalScheduler(),
})
```

Limitations:
- No timezone support
- No day-of-week or month-specific scheduling
- Complex expressions fall back to 1-hour intervals
- Timer drift over long periods

### Custom Scheduler

Implement the `CronScheduler` interface for any backend:

```ts
import type { CronScheduler } from '@forinda/kickjs-cron'
import cron from 'node-cron'

class NodeCronScheduler implements CronScheduler {
  private tasks: cron.ScheduledTask[] = []

  schedule(expression: string, callback: () => void, options?: { timezone?: string }) {
    const task = cron.schedule(expression, callback, {
      timezone: options?.timezone,
    })
    this.tasks.push(task)
    return task
  }

  stop(handle: cron.ScheduledTask) {
    handle.stop()
    this.tasks = this.tasks.filter(t => t !== handle)
  }

  stopAll() {
    this.tasks.forEach(t => t.stop())
    this.tasks = []
  }
}

// Use it
CronAdapter({
  services: [ReportService],
  scheduler: new NodeCronScheduler(),
})
```

## Cron Expression Format

Standard 5-part format: `minute hour day month weekday`

| Expression | Description |
|---|---|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 */2 * * *` | Every 2 hours |
| `0 0 * * *` | Daily at midnight |
| `0 9 * * MON-FRI` | Weekdays at 9am |
| `0 0 1 * *` | First of each month |

6-part format with seconds: `second minute hour day month weekday`

| Expression | Description |
|---|---|
| `*/30 * * * * *` | Every 30 seconds |
| `*/10 * * * * *` | Every 10 seconds |

With croner, 7-part format adds year: `second minute hour day month weekday year`

Advanced patterns (croner only):

| Pattern | Description |
|---|---|
| `0 0 L * *` | Last day of each month |
| `0 9 * * MON#1` | First Monday of each month at 9am |
| `0 0 15W * *` | Nearest weekday to the 15th |

## @Cron Options

| Option | Type | Description |
|---|---|---|
| `description` | `string` | Human-readable label shown in logs |
| `timezone` | `string` | IANA timezone (e.g. `'America/New_York'`, `'UTC'`) |
| `runOnInit` | `boolean` | Run once immediately on startup |

```ts
@Cron('0 9 * * MON-FRI', {
  description: 'Morning report',
  timezone: 'America/New_York',
  runOnInit: true,
})
async morningReport() { ... }
```

## CronAdapter Options

```ts
interface CronAdapterOptions {
  /** Service classes containing @Cron methods */
  services: any[]
  /** Enable/disable all cron jobs (default: true) */
  enabled?: boolean
  /** Scheduler backend (default: auto-detect) */
  scheduler?: CronScheduler
}
```

Set `enabled: false` to disable all cron jobs — useful for separating web and worker processes:

```ts
CronAdapter({
  services: [ReportService],
  enabled: process.env.ROLE === 'worker', // only run on worker
})
```

## CronScheduler Interface

```ts
interface CronScheduler {
  /** Schedule a callback. Returns an opaque handle. */
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: { timezone?: string },
  ): any

  /** Stop a single job by handle. */
  stop(handle: any): void

  /** Stop all jobs. Called on shutdown. */
  stopAll(): void
}
```

## Graceful Shutdown

All scheduled jobs are stopped automatically when the adapter's `shutdown()` is called during the KickJS application graceful shutdown.
