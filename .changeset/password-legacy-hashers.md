---
'@forinda/kickjs': minor
---

`verifyPassword(password, stored, { legacy })` verifies hashes in other formats, such as bcrypt or argon2 rows imported from another system, through a `LegacyHasher` (`matches` + `verify`, your library's own check). A match returns `needsRehash: true`, so the account moves to scrypt at its next login. Scrypt hashes never reach a legacy hasher, and a `verify` that throws counts as a failed match.
