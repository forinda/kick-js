---
'@forinda/kickjs': minor
---

`metricsAdapter()` serves Prometheus metrics at `/metrics`. It exports a request-duration histogram by method, route pattern and status, with unmatched requests grouped under `route="unmatched"` so random URLs can't add series. It also reports resident memory, heap, event-loop lag and uptime. An optional bearer `token` protects the endpoint.
