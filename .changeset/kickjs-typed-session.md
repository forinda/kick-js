---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': patch
---

`ctx.session` is typed `Session` instead of `any`. Declare your session keys once by augmenting `SessionData` and every read is typed:

```ts
declare module '@forinda/kickjs' {
  interface SessionData {
    userId?: string
  }
}
ctx.session.data.userId // string | undefined
```

Undeclared keys read as `unknown`. Code that relied on `any` — `ctx.session.userId` (the data lives under `.data`), or passing `ctx.session.data.x` where a `string` is expected — now needs the declaration above or a cast. The generated agent docs' guard example read `ctx.session?.user`, which never existed; it now reads a typed `ctx.session?.data.role`.
