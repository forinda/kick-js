---
'@forinda/kickjs-cli': patch
---

`kick new`: scaffold the compiler API the client route map needs, and document when to use it

Generated projects pin `typescript@^7.0.2`, which ships no JS compiler API — so
every `kick typegen` in a freshly scaffolded project printed a skip warning and
never produced `.kickjs/types/kick__client.d.ts`:

```text
kick/client: skipped — … neither 'typescript' nor '@typescript/typescript6' resolved
```

The scaffold now pins `@typescript/typescript6` alongside it, and a new project
emits a fully-typed client map out of the box.

The fullstack template keeps the ambient bridge as its default wiring: its whole
point is the live loop (rename a field, the web app stops compiling), which
depends on `kick dev` refreshing the route types on save — and the client map is
deliberately not refreshed under watch. The generated README gains a "When to
switch to `kick__client.d.ts`" section covering the swap, what it costs, and the
cases that call for it: a frontend in its own repo, one setting
`verbatimModuleSyntax`, or one whose typecheck has started paying for the
server's.
