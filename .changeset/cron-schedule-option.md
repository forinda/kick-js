---
'@forinda/kickjs': minor
---

`KickCronAdapter({ schedule })` drives `@Cron` jobs with any scheduler library — node-cron, `cron`, your own — instead of `croner`: a function that starts one job's timer and returns something with `stop()`. The adapter still resolves each job, applies `enabled` and `overlap`, reports failures, keeps to one worker per cluster and waits for running jobs on shutdown. Without `schedule` it uses `croner` as before. New types: `CronScheduler`, `CronSchedule`.
