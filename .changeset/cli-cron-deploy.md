---
'@forinda/kickjs-cli': minor
---

`kick build:vercel` writes a Vercel cron for every distinct `@Cron` expression in `src/`, pointing at the app's `/_kick/cron/<id>` trigger. It routes `/_kick/*` to the function when the API path doesn't already cover it, and reminds you to set `CRON_SECRET`.

It warns about jobs Vercel can't run as written: a non-literal expression, and a `timezone` (Vercel crons are UTC).

`kick build:netlify` warns that `@Cron` jobs won't run on Netlify.
