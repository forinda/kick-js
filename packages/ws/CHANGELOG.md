# @forinda/kickjs-ws

## 5.2.2

### Patch Changes

- [#267](https://github.com/forinda/kick-js/pull/267) [`04cd61d`](https://github.com/forinda/kick-js/commit/04cd61d2d932ea3d2a642afc72e84bc80ee28907) Thanks [@forinda](https://github.com/forinda)! - deps: move `ws` from `dependencies` to `peerDependencies` in both packages

  Both `@forinda/kickjs-ws` and `@forinda/kickjs-devtools` shipped `ws@^8.20.1` as a hard `dependency`. Adopters who already had `ws` installed (very common — it's used directly, through `socket.io`, through `undici`, through tons of other libs) could end up with two copies in `node_modules`, which breaks `instanceof WebSocket` checks and confuses some bundlers.

  Both packages now declare `ws` as a `peerDependencies` entry at `^8.0.0`. `ws@^8.20.1` stays in `devDependencies` so the workspace install/build/test still resolves a copy. Modern package managers auto-install peers (pnpm 8+ with `auto-install-peers=true`, npm 7+), so most adopters need no action; pnpm strict-mode users add `ws` to their dependencies explicitly.

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
