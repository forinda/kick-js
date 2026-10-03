---
'@forinda/kickjs-queue': patch
---

`QueueService.dispatch` (the `JOB_DISPATCHER`) stamps the dispatching code's job context onto the job, so `registerJobContext` carriers such as kick/db's tenancy reach the handler.
