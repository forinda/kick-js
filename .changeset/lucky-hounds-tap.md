---
'@forinda/kickjs-db': patch
---

Retire the `@forinda/kickjs-db-pg` / `-db-mysql` / `-db-sqlite` shim packages.

They had been frozen as `private: true` nine-line re-exports of
`@forinda/kickjs-db/{pg,mysql,sqlite}` since the dialects merged into this
package, so they no longer publish — their last npm versions still resolve for
existing installs. Their integration suites (121 tests) move here under
`__tests__/{pg,sqlite,mysql}`; no runtime code changed.
