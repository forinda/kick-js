---
'@forinda/kickjs': minor
---

`reply()` takes headers: `reply(status, body, { headers })`, and `reply.created(body, { location })` answers 201 with a `Location` header. The runtime sets them before sending, on Express, Fastify, h3 and the `@forinda/kickjs/web` entry. The inferred type is unchanged — `reply.created(user, { location })` is still `Reply<201, User>`, and typegen still unwraps it to `User`. New exported types: `ReplyOptions`, `ReplyHeaders`.

```ts
const user = await this.users.create(ctx.body)
return reply.created(user, { location: ctx.urlFor('UsersController.show', { id: user.id }) })
```
