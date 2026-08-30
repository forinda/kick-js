---
'@forinda/kickjs-cli': minor
---

Remove `kick g job`

The job generator scaffolded a `@Job` processor around
`@forinda/kickjs-queue`, a package no template installs — so in most projects
it wrote a file that could not compile.

The deeper reason is ownership. A generator for an interface KickJS defines —
`AppAdapter`, `KickPlugin`, a context contributor, a middleware signature —
prevents a class of mistake that fails at boot rather than at the keyboard, and
maintaining it is work the framework owes adopters. A queue processor is not
that shape: it belongs to whichever queue you actually run, which the framework
cannot know and should not track.

Every other generator stays. `defineGenerator` in `kick.config.ts` gives a
project its own `kick g job` in about twenty lines, shaped to the library it
chose — see
[plugin generators](https://kickjs.app/guide/plugin-generators.html), which now
documents the full `GeneratorSpec` / `GeneratorContext` / `GeneratorFile` API,
testing, dispatch, and that worked example.
