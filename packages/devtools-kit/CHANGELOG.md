# @forinda/kickjs-devtools-kit

## 5.3.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.3.0

### Minor Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Add `@forinda/kickjs-devtools-kit/bus/token` subpath that exports `DEVTOOLS_BUS` separately from the bus runtime. Browser SPAs and other framework-free consumers can now import from `/bus` without pulling `createToken` (and through it the entire `@forinda/kickjs` runtime) into their bundle. Server-side adapters and plugins that need the DI token import it from `/bus/token`.

  The README now documents every subpath (`.`, `/runtime`, `/types`, `/bus`, `/bus/token`) with whether each one pulls in the framework, and the lockstep-versioning claim has been replaced with the Changesets-based flow.
