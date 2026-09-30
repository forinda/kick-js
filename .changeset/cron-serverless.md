---
'@forinda/kickjs': minor
---

`@Cron` jobs can run on the Node server, on Vercel and on Cloudflare Workers.

- **Options:** `name` (stable job name), `overlap` (default off: a tick that finds the job still running is skipped), `enabled` (a boolean, or a function checked on each tick) and `meta` (free-form data).
- **Run context:** the handler receives a `CronRun` with `name`, `expression`, `meta`, `firedAt` and `trigger`.
- **Errors:** a failed job is reported to the error observers with `source: 'cron'`.
- **Node:** `KickCronAdapter()` schedules jobs using the optional peer `croner`. It's opt-in, so apps that run `@Cron` jobs with their own adapter don't run them twice. In cluster mode only one worker schedules.
- **Serverless:** with `CRON_SECRET` set, `createHandler()` apps answer `GET /_kick/cron/:scheduleId` (bearer-guarded) by running the jobs on that schedule. The web entry's `createFetchHandler()` returns `scheduled()` for Workers cron triggers.
- **New exports:** `KickCronAdapter`, `CRON_WORKER_ENV`, `listCronJobs`, `runCronJob`, `runCronJobs`, `cronScheduleId`, `isCronJobEnabled`, and the `CronRun` / `CronJob` / `CronOptions` types.
