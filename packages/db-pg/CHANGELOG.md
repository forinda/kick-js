# @forinda/kickjs-db-pg

## 7.0.0

### Patch Changes

- Updated dependencies [[`c601090`](https://github.com/forinda/kick-js/commit/c60109029a59694da9478dd714cb9aea684765fe), [`6be566a`](https://github.com/forinda/kick-js/commit/6be566a636fe1bbdd3c0b6b56d048f34c2c759e0), [`64ff558`](https://github.com/forinda/kick-js/commit/64ff558a2f1cee096f040a93b44d8eb68cd73255)]:
  - @forinda/kickjs-db@5.4.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`45fd19d`](https://github.com/forinda/kick-js/commit/45fd19da8ad2856d1ac591b25a112098f9f642ca), [`efebe58`](https://github.com/forinda/kick-js/commit/efebe584147c2ed97c2741c49efe29164d2976d6), [`0a63cfc`](https://github.com/forinda/kick-js/commit/0a63cfc90cdc02c94dbdd410ac5f46d1952c3d06), [`b98bcbe`](https://github.com/forinda/kick-js/commit/b98bcbe67ab3fd4bb33039831e3b87702a053919)]:
  - @forinda/kickjs-db@5.3.0

## 5.2.2

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

- Updated dependencies [[`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e)]:
  - @forinda/kickjs-db@5.2.2

## 5.2.1

### Patch Changes

- Updated dependencies [[`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98)]:
  - @forinda/kickjs-db@5.2.1
