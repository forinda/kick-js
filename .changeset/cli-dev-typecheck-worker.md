---
'@forinda/kickjs-cli': minor
---

`kick dev --typecheck` (or `dev.typecheck: true` in kick.config) runs the project's own TypeScript checker after each debounced change and surfaces diagnostics without leaving the dev console. Resolves `tsgo` (`@typescript/native-preview`) from the project's `node_modules/.bin`, falling back to `tsc`; runs `--noEmit` after the typegen pass settles so checks always see fresh `.kickjs/types`. In-flight runs are killed when a new save lands. Failures print a capped diagnostic summary and broadcast a `kickjs:typecheck` HMR event with the full output; a healthy project stays quiet, and the first clean run after an error prints a "clean again" line. Off by default.
