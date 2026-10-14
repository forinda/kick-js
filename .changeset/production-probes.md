---
'@forinda/kickjs': minor
---

Production behaviour behind load balancers and on Kubernetes:

- `/health/live` stays `200` (`status: 'draining'`) during shutdown. Only `/health/ready` answers `503`. A failing liveness probe gets the container restarted, which cut graceful shutdowns short.
- Readiness checks get a timeout each (`health: { checkTimeout }`, default 2s). A hung or throwing `onHealthCheck()` counts as down (`reason: 'timeout' | 'error'`) instead of hanging the probe. Probes within a second share one run, and slow checks are logged.
- New `preStopDelay`: after shutdown begins, keep serving for that long with readiness already `503`, so balancers stop routing before connections are refused.
- The production server sets `keepAliveTimeout` 65s, `headersTimeout` 66s and `requestTimeout` 300s by default (configurable under `server`). Node's 5s keep-alive is shorter than common load balancer idle timeouts, which causes intermittent 502s.
