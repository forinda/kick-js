# @forinda/kickjs-ws

## 7.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`d6622d5`](https://github.com/forinda/kick-js/commit/d6622d5d1d9c10cd2c446203fbaa2d143d13f2ea), [`fe1b578`](https://github.com/forinda/kick-js/commit/fe1b578344f5af05077c92023e5f549ddcb4edf4), [`79f2989`](https://github.com/forinda/kick-js/commit/79f298985606e6a1bf2bd2ae558910ad615226d1), [`3e5d03e`](https://github.com/forinda/kick-js/commit/3e5d03e7144a19ff26d44b7f882b86f564c6de17), [`d049c48`](https://github.com/forinda/kick-js/commit/d049c48015e1331eeae3f75ea4e536871cb03fd5), [`335c247`](https://github.com/forinda/kick-js/commit/335c24724293ff7c900f50ec20350b47d968f6e7), [`c6e4d73`](https://github.com/forinda/kick-js/commit/c6e4d73c2ad8be3725c91673451ab994a648a7f8), [`8fc8c1a`](https://github.com/forinda/kick-js/commit/8fc8c1a23d0e717edc1ccc54089141036a0ae975), [`0e18440`](https://github.com/forinda/kick-js/commit/0e1844075a074e11413c6811b0eb3137ee0c4b7c), [`d0bc46d`](https://github.com/forinda/kick-js/commit/d0bc46d7336fb9395c7b4f71fe74e94f1a2301e5), [`07a3a15`](https://github.com/forinda/kick-js/commit/07a3a15d51aaa55372e58ee2eafa11f6841245dd), [`d66dc5b`](https://github.com/forinda/kick-js/commit/d66dc5b337c8f961e4b9329607901bad850e0f91), [`841637e`](https://github.com/forinda/kick-js/commit/841637ec9d19f7df727db7342603e7e48bb07e25), [`6c59776`](https://github.com/forinda/kick-js/commit/6c5977641707cb533a86fcf701d249ef3bff3215), [`d500c8a`](https://github.com/forinda/kick-js/commit/d500c8a9d3b11277392e88e0369cb2fd2b39cf78)]:
  - @forinda/kickjs@5.18.0-alpha.0

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

## 5.2.3

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

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
