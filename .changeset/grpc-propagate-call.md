---
'@forinda/kickjs-grpc': minor
---

`propagateCall` — a Connect interceptor for clients that call other services while serving a request or an RPC. Each outgoing call carries the current `x-request-id` and, when `traceContext()` ran, `traceparent`; inside an RPC, the call is cancelled when the incoming one is (client cancel or deadline). The RPC being served is kept in the request store under `GRPC_CALL`. New guide: Microservices.
