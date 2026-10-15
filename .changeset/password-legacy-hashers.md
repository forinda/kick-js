---
'@forinda/kickjs': minor
---

`verifyPassword(password, stored, { legacy })` verifies hashes in other formats, such as bcrypt or argon2 rows imported from another system, through a `LegacyHasher` (`matches` + `verify`, your library's own check). A match returns `needsRehash: true`, so the account moves to scrypt at its next login. Each hasher gives a `dummy` hash. Every check runs scrypt once and each hasher once, so a scrypt account, an imported one and a missing one take the same time. Scrypt hashes never reach a legacy hasher, and a `verify` that throws counts as a failed match.
