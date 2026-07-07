---
'@forinda/kickjs': minor
'@forinda/kickjs-client': minor
'@forinda/kickjs-cli': minor
---

feat: typed SSE end to end + the `KickApi` alias

```ts
// server — ctx.sse is now generic; `return sse` carries the event type
const sse = ctx.sse<{ n: number }>()
sse.send({ n: 1 }) // typed
return sse

// client — only SSE routes accepted; events typed
const stream = await api.stream('/events')
for await (const ev of stream) ev.data // { n: number }
```

- `@forinda/kickjs`: `SseHandler<T>` (phantom `__sse` marker — structural
  detection, no server imports needed client-side)
- `@forinda/kickjs-client`: `api.stream()` — fetch-based SSE parser (works
  with injected fetch/`createTestClient`), `SseEvent<T>` with JSON-parsed
  data + `event`/`id`, `close()` aborts; also STRICTER options: omitting a
  required `params`/`body` argument is now a compile error (was a runtime
  throw)
- `kick typegen` emits a global `KickApi` alias for `KickRoutes.Api` —
  `createClient<KickApi>` everywhere
