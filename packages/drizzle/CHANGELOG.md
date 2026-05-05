# @forinda/kickjs-drizzle

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
