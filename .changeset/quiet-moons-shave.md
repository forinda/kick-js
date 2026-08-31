---
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-schema': patch
'@forinda/kickjs-grpc': patch
'@forinda/kickjs-devtools-kit': patch
---

README corrections and cuts — a version bump so they reach npm.

The README is what npmjs.com renders, and it ships in the tarball, so a fix
only reaches readers on a publish. These four packages have no code change in
this release; the bump exists to publish the README.

- **mcp** — `@Roles('admin')` and `@Public()` came from `@forinda/kickjs-auth`,
  which no longer exists. Five passages described the adapter as running an
  "Express pipeline"; it dispatches through the shared HTTP pipeline on any
  runtime. Cut 560 → 176 lines: the auth-pattern walkthrough, three ASCII
  diagrams, the troubleshooting table and an alternative the README itself
  called not-recommended are all in the guide.
- **schema** — cut 283 → 132. Per-adapter internals, two resolution orders and
  a full Joi adapter implementation live in the guide; the `KickSchema`
  interface and the subpath table, which are the decisions, stay.
- **grpc** — cut 206 → 121. Kept the protocol-support table.
- **devtools-kit** — the recommended dependency shape said `>=5.0.0` / `^5.0.0`
  for a package published at 7.0.1.

`@forinda/kickjs`, `-cli` and `-testing` also had README changes and are
already bumping in this release, so they need no entry here.
