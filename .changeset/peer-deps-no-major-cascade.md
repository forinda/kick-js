---
'@forinda/kickjs-db-pg': patch
'@forinda/kickjs-db-mysql': patch
'@forinda/kickjs-db-sqlite': patch
---

chore(db-peers): use `workspace:^` instead of `workspace:*` for the `@forinda/kickjs-db` peer range — keeps minor core bumps from cascading to major peer bumps

`workspace:*` was publishing as the **exact** core version (e.g. `5.6.0`). Every minor bump on `@forinda/kickjs-db` (e.g. `5.6 → 5.7`) made the peer's `peerDependencies` range string change too, which changesets-action correctly flagged as a peer-range change → escalated to a **major** bump on every peer adapter even when the peer's own source was unchanged. That's why the kysely 0.29 release shipped `db-pg@9.0.0` / `db-mysql@2.0.0` / `db-sqlite@2.0.0` from a minor changeset.

`workspace:^` publishes as a caret range (e.g. `^5.6.0`), so the next `5.7.0` core release stays in-range — the peer's `peerDependencies` string doesn't change → no cascade. Only an actual major core bump (`6.0.0`) lands out of range and triggers the major-on-peers escalation, which is the correct semantic.

Combined with the existing `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true` config (which was already present but ineffective because `workspace:*` made every change "out of range"), future iterations stay on patch + minor unless an adapter's own source changes warrant otherwise.
