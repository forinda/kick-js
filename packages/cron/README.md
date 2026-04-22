# @forinda/kickjs-cron

Cron scheduling for KickJS — `@Cron` decorator on `@Service` methods, pluggable schedulers (`CronerScheduler` for full cron syntax, `IntervalScheduler` zero-dep fallback).

## Install

```bash
kick add cron
```

## Quick Example

```ts
import { Service, Cron, bootstrap } from '@forinda/kickjs'
import { CronAdapter } from '@forinda/kickjs-cron'
import { modules } from './modules'

@Service()
class CleanupService {
  @Cron('0 */6 * * *') // every 6h
  async cleanExpiredTokens() { /* ... */ }

  @Cron('0 9 * * 1', { timezone: 'UTC' }) // Mon 09:00 UTC
  async weeklyDigest() { /* ... */ }
}

export const app = await bootstrap({
  modules,
  adapters: [CronAdapter({ services: [CleanupService] })],
})
```

## Documentation

[forinda.github.io/kick-js/guide/cron](https://forinda.github.io/kick-js/guide/cron)

## License

MIT
