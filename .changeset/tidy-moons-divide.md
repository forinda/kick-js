---
'@forinda/kickjs': major
'@forinda/kickjs-testing': major
'@forinda/kickjs-cli': patch
---

`middleware` is gone; the option is `middlewares`.

`bootstrap()` took both — `middlewares` as the real name and `middleware` as a
deprecated alias, with the plural winning when both were set. The alias has
carried a `@deprecated` tag for several releases, and v8 is the window to drop
it, so there is one name for one thing:

```ts
bootstrap({
  modules,
  middlewares: [helmet(), cors(), requestId()],
})
```

The rename is mechanical and the compiler finds every site: `middleware` is no
longer a key on `ApplicationOptions`, so passing it is a type error rather than
a silently ignored object.

Renamed in the same place, for the same reason:

- **`createTestApp({ middlewares })`** — the harness passes the option straight
  through to `bootstrap()`, and a test harness whose option name disagreed with
  the thing it configures is the inconsistency this change exists to remove.
  This is why `@forinda/kickjs-testing` takes a major too.
- **`createWebApp({ middlewares })`** — the web/edge entry had its own
  `middleware`, ctx-style rather than connect-style, but the same name.

**`AppAdapter.middleware()` and `Plugin.middleware()` are unchanged.** They are a
different API — a hook returning entries, not an option taking them — and
nothing about them was ambiguous.

Generated projects emit `middlewares` from the CLI's `rest` template.
