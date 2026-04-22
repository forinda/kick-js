# @forinda/kickjs-cron

Production-grade cron job scheduling with pluggable backends for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add cron

# Manual install
pnpm add @forinda/kickjs-cron croner
```

## Features

- `CronAdapter` — lifecycle adapter that discovers and runs cron jobs
- `@Cron` decorator for scheduling methods
- Built-in schedulers: `CronerScheduler` (cron expressions), `IntervalScheduler` (simple intervals)
- `getCronJobs()` to inspect registered jobs

## Quick Example

```typescript
import { CronAdapter } from '@forinda/kickjs-cron'
import { Cron, Service } from '@forinda/kickjs-core'

@Service()
class CleanupService {
  @Cron('0 */6 * * *') // Every 6 hours
  async cleanExpiredTokens() {
    console.log('Cleaning up expired tokens...')
  }

  @Cron('0 9 * * 1') // Monday at 9am
  async weeklyDigest() {
    console.log('Sending weekly digest...')
  }
}

bootstrap({
  modules,
  adapters: [CronAdapter()],
})
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/cron)

## License

MIT
