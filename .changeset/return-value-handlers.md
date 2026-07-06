---
'@forinda/kickjs': minor
---

feat: return-value handlers — `return` the payload instead of calling `ctx.json`

Handlers on every runtime (Express, Fastify, h3, h3-web, `@forinda/kickjs/web`)
may now return their response:

```ts
@Get('/:id')
async get(ctx: RequestContext) {
  return this.users.find(ctx.params.id)          // → 200 json
}

@Post('/')
async create(ctx: RequestContext) {
  return reply(201, await this.users.create(ctx.body)) // → 201
}
```

- `reply(status, body)` + sugars (`created`/`accepted`/`noContent`) carry the
  status in the type (`Reply<201, Task>`) for upcoming response inference
- Fully additive: `ctx.json` style unchanged and always wins over a return
  value; `undefined` returns keep prior behavior exactly
- Foundation for typed response inference in `kick typegen` and the typed
  client (`response-inference-design.md`)
