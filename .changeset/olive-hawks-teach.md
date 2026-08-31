---
'@forinda/kickjs': patch
'@forinda/kickjs-cli': patch
---

`helmet()` options were half-inert, because the framework injected a second one.

`bootstrap()` auto-injects `helmet()` with defaults unless `security.helmet` is
`false`, and it did so **ahead of the user middleware array**. So an app that
declared its own `helmet(...)` ran two of them, and the second could only ever
overwrite a header — never drop one:

```ts
bootstrap({ middleware: [helmet({ frameguard: false })] })
// still: X-Frame-Options: DENY
```

Every `false` option behaves this way — `frameguard: false`, `hsts: false`,
`referrerPolicy: false`, `noSniff: false`. The option is accepted, type-checks,
and silently does nothing, because the auto-injected pass already set the header
and the user's pass merely declines to set it again. Disabling `frameguard` to
allow embedding is the case that bites: the app looks configured and is not.

`helmet()` now brands its handler with `Symbol.for('kick/http/helmet')`, and
auto-injection stands down when it finds that brand in the declared middleware —
so a declared helmet is the only one, and its options mean what they say.
`security.helmet: false` still turns the automatic one off for an app that
declares nothing.

Read through the registry rather than an import, so the Application keeps the
dynamic `import()` that lets the helmet module be absent.

**The scaffolded template kept `helmet()`**, now with a comment saying what it is
for. Reported as a no-op in the `rest` template (#569) — accurately: it sets the
same headers the automatic one already set, so adding or removing that line
changed no response. The measurement was right and the conclusion would have been
wrong. It is not decoration, it is the configuration seam — and until this fix
it was a seam that did not work.

Guarded by two tests: an explicit `frameguard: false` removes the header, and a
bare `helmet()` still emits exactly the same header set as none at all — the
second being the reporter's own observation, kept so the template's line stays
honest.
