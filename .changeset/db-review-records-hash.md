---
'@forinda/kickjs-db': patch
---

Hand-written SQL in a migration applies. The journal hash was recorded at `generate` and never again, so filling in a `kick db generate <name> --empty` migration — which its own output tells you to do — or editing a generated one before review failed `migrate latest` with "Hash mismatch", reviewed or not. `kick db migrate review <id>` now records the hash of the files as reviewed, and the runner checks the hash only for reviewed migrations: an edit after review is still refused, until you review it again. An unreviewed migration applied in development is recorded with its current hash.
