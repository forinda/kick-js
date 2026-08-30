---
'@forinda/kickjs-cli': minor
---

Remove `kick g job`

The job generator emitted a `@Job` processor importing `@forinda/kickjs-queue`,
a package no template installs — so in most projects it wrote a file that could
not compile.

Queue processors are a good fit for a custom generator rather than a built-in:
`defineGenerator` in `kick.config.ts` gives a project its own `kick g job` with
whatever shape its queues actually use. See
[plugin generators](https://kickjs.app/guide/plugin-generators.html).
