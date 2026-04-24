# @forinda/kickjs-cron

Production-grade cron job scheduling with pluggable backends.

::: danger Deprecated — dropped in v5
This package is deprecated and will be removed in v5. New projects should use the BYO recipe in [Scheduled tasks with KickJS](../guide/cron.md), which wraps `croner` (or `node-cron`, or raw `setInterval`) with a `defineAdapter()` that reads `@Cron` decorator metadata via `Reflect`. The API below documents v4.2.0 behaviour for adopters mid-migration.
:::

## @Cron

```typescript
function Cron(
  expression: string,
  options?: {
    description?: string
    timezone?: string
    runOnInit?: boolean
  },
): MethodDecorator
```

## getCronJobs

```typescript
function getCronJobs(target: any): CronJobMeta[]

interface CronJobMeta {
  expression: string
  handlerName: string
  description?: string
  timezone?: string
  runOnInit?: boolean
}
```

## CronScheduler

```typescript
interface CronScheduler {
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: { timezone?: string },
  ): any
  stop(handle: any): void
  stopAll(): void
}
```

## CronerScheduler

```typescript
class CronerScheduler implements CronScheduler {
  constructor(cronerModule?: { Cron: any } | any)
  init(): Promise<void>
}
```

Requires `croner` peer dependency.

## IntervalScheduler

```typescript
class IntervalScheduler implements CronScheduler {}
```

Zero-dependency fallback using `setInterval`.

## CronAdapter

```typescript
const CronAdapter: AdapterFactory<CronAdapterOptions>

interface CronAdapterOptions {
  services: any[]
  enabled?: boolean
  scheduler?: CronScheduler
}
```

Built with `defineAdapter()` — call it as `CronAdapter({ services: [...] })` and pass the result to `bootstrap({ adapters: [...] })`.
