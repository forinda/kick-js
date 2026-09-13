---
'@forinda/kickjs': minor
---

Contributors can run before request validation with `beforeValidation: true`.

Validation runs ahead of the contributor pipeline, so with authentication as a
contributor, a request with no credentials and a malformed body answered 422
instead of 401 — telling an anonymous caller what the schema expects, and
forcing every "rejects without a token" test to send a valid body.

```ts
const Authenticate = defineHttpContextDecorator({
  key: 'user',
  beforeValidation: true,
  resolve: (ctx) => verify(ctx.headers.authorization) ?? throwUnauthorized(),
})
```

A `beforeValidation` contributor runs right after the route is matched — before
validation, file upload and `@Middleware()` handlers — on Express, Fastify, h3
and the web entry. So `@Middleware()` guards can read its value (a role check
after authentication), while other contributors keep their place after
middleware. The default order is unchanged for every contributor that does not
set it.

`ctx.body`, `ctx.query` and `ctx.params` are unvalidated at that point, and an
upload may not be parsed yet: read credentials, not the payload. A
`beforeValidation` contributor may only `dependsOn` others that also set it;
anything else fails boot with an error naming both keys.
