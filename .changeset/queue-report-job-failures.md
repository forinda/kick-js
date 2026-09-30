---
'@forinda/kickjs-queue': patch
---

A failed job is reported to the app's error observers (`onError` with `source: 'job'` and `context: { queue, job, id, attemptsMade }`), in addition to the existing log line. On a `@forinda/kickjs` release without `reportError`, it's skipped.
