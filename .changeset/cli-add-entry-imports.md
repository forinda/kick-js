---
'@forinda/kickjs-cli': patch
---

`kick add queue` / `kick add storage` with `--entry` in another directory (`--entry src/app/index.ts`) import the adapter they write from the right path (`../adapters/queue`) instead of `./adapters/queue`, which didn't resolve.
