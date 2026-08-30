---
'@forinda/kickjs-cli': patch
---

typegen: stop warning about the client route map in projects that do not use it

`kick/client` warned on every `kick typegen` when no TypeScript compiler API
was available, and reported having "removed the previously generated"
`kick__client.d.ts` even in projects that never had one — `rm --force`
succeeds either way.

Most projects do not consume that file. The fullstack template's web app is
wired to the ambient `KickRoutes.Api` so it stays live under `kick dev`, and
the rest/minimal templates have no frontend at all. The compiler API is not a
free thing to tell them to install either: on TypeScript 7 it means
`@typescript/typescript6`, a 10 kB shim over a 24 MB `typescript@6`.

So the skip is now quiet when there is no map on disk (visible under
`LOG_LEVEL=debug`) and loud when there is one — a project with a map is using
it, and losing it is a regression worth interrupting for. The removal notice
only fires when a file was actually removed, and now prints after the cause it
refers to.

The fullstack template's README gains a "When to switch to
`kick__client.d.ts`" section: the one-line swap, the `@typescript/typescript6`
install it needs on TS 7, the two lines to delete afterwards, and the trade —
no refresh under `kick dev`, with `--check` as the CI backstop.
