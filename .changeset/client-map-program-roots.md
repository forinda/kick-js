---
'@forinda/kickjs-cli': patch
---

typegen: stop loading project files the client route map cannot reach

The client map built its TypeScript program over every file the tsconfig
lists. It does not need to: the probe imports the generated route map, which
imports the controllers, which import their services and DTOs — so everything
that can contribute to a route type arrives transitively. Passing the whole
project on top loaded files no route can reference. On a 1,940-route app, 686
of the 2,851 roots were tests.

Measured on that app, median of five runs:

|            | before  | after   |
| ---------- | ------- | ------- |
| peak RSS   | 1376 MB | 1122 MB |
| wall clock | 8.62s   | 7.61s   |

with byte-identical output.

Roots are now the tsconfig's declaration files plus everything typegen itself
emits — and that second list is read from disk rather than taken from the
tsconfig. TypeScript's `include` skips dot-directories, so `.kickjs/types` was
absent from the file list unless the adopter happened to spell out a glob for
it, and `kick__env.ts` carries a `declare global` that nothing imports. Those
globals were therefore missing for a project that did not glob them, and a
controller referencing one resolved against an error type — visible in the
emitted map as a bare identifier the frontend has never heard of.
