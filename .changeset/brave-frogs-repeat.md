---
'@forinda/kickjs-testing': minor
---

`createTestApp` overrides accept an `InjectionToken` key.

`overrides` was typed `Record<symbol | string, any>`, but the framework's own
recommended DI key is `createToken()` — a frozen OBJECT identified by reference.
TypeScript rejects an object as a computed property key, so the natural call did
not compile:

```
error TS2464: A computed property name must be of type 'string', 'number',
'symbol', or 'any'.
```

Tokens are the documented way to bind an interface to an implementation, and the
generator emits one per repository, so the one key type most worth overriding in
a test was the one shape `overrides` could not take.

The obvious workaround is worse than the error: `[TOKEN.name]` is a string, so
it compiles — and the container keys tokens by reference, so the override is
accepted and silently never applied.

`overrides` now also accepts entries or a `Map`, both of which preserve the
token's identity:

```ts
const DATABASE = createToken<Database>('app/Db/connection')

await createTestApp({
  modules: [UserModule()],
  overrides: [[DATABASE, fakeDb()]],
})
```

The object form is unchanged for string and symbol keys. A test pins the
silent-failure case too, so the by-name behaviour cannot drift into looking like
it works.
