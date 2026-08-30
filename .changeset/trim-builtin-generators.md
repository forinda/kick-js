---
'@forinda/kickjs-cli': major
---

Remove `kick g test`, `adapter`, `plugin`, `contributor` (and `job`)

`kick g` now ships eight generators: `module`, `controller`, `service`,
`middleware`, `guard`, `dto`, `scaffold`, `config`.

A built-in generator has to guess — which queue library, which test style,
which folder layout, which optional packages are installed. Guessing wrong
writes a file that does not compile into a repo the adopter did not ask to have
touched, which is what `kick g job` did by importing `@forinda/kickjs-queue`
whether or not the project had it.

The removed five were each either trivial to hand-write (a Vitest file carries
no framework wiring) or written once per project rather than per feature
(adapters, CLI plugins, contributors). Every one is a short `defineGenerator`
you own and can shape to your own layout —
[Replacing a removed generator](https://kickjs.app/guide/plugin-generators.html#replacing-a-removed-generator)
has the code for all of them, and the extension guide grew to cover the full
`GeneratorSpec` / `GeneratorContext` / `GeneratorFile` API, testing, and
dispatch.

`generateAdapter` is no longer exported from `@forinda/kickjs-cli`.

Also removed: `generators/auth-scaffold.ts`, which no command reached, and the
`kick g auth-scaffold` docs section for a command that never existed.
