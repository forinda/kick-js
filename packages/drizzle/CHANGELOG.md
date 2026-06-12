# @forinda/kickjs-drizzle

## 6.0.1

### Patch Changes

- [#348](https://github.com/forinda/kick-js/pull/348) [`37459a7`](https://github.com/forinda/kick-js/commit/37459a722c2121cc55480f16900a0268b91ef11b) Thanks [@forinda](https://github.com/forinda)! - Mark both packages as deprecated. They were early-adoption adapters and are no longer maintained — wire the ORM directly in your app (BYO), or use `@forinda/kickjs-db`, the built-in Kick ORM, if you prefer to skip external ORMs. Importing either now prints a one-time console warning (suppress with `KICKJS_SUPPRESS_DEPRECATION=1`) and the entry modules carry `@deprecated` JSDoc so editors flag usages. Both packages will be removed in a future major.

## 6.0.0

## 6.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`f04da5b`](https://github.com/forinda/kick-js/commit/f04da5b9ac7d496a57d357f2b8d4d2a2c9507e62), [`0d9a895`](https://github.com/forinda/kick-js/commit/0d9a8955f358f8ca8be8aca169dfa38285c48f50), [`a4fc68c`](https://github.com/forinda/kick-js/commit/a4fc68c991b996cae08800e7e9c1f0e8f39eaaeb)]:
  - @forinda/kickjs@5.14.0-alpha.0

## 5.3.1

### Patch Changes

- [#271](https://github.com/forinda/kick-js/pull/271) [`860b366`](https://github.com/forinda/kick-js/commit/860b366c01dec4d3dfe6b8f3d90d75e534cff8d8) Thanks [@forinda](https://github.com/forinda)! - chore(meta): focus npm keywords per-package, drop sibling self-references

  Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

  Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

  No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.

## 5.3.0

### Minor Changes

- [#174](https://github.com/forinda/kick-js/pull/174) [`9b1225c`](https://github.com/forinda/kick-js/commit/9b1225c12ff4d02d758ebe977e5d771ae9a27cbd) Thanks [@forinda](https://github.com/forinda)! - Bump `drizzle-orm` peer-dep floor from `>=0.30.0` to `>=0.45.2` to
  push adopters off the **HIGH-severity SQL injection** in earlier
  0.45.x and below ([GHSA advisory][advisory]). Pure peer-range change —
  no API change in `@forinda/kickjs-drizzle` itself.

  **Adopter action**: bump your `drizzle-orm` to `>=0.45.2`. If you're
  already on `>=0.45.2`, nothing to do.

  [advisory]: https://github.com/advisories/GHSA-gpj5-g38j-94v9

## 5.2.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
