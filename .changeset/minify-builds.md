---
'@forinda/kickjs': patch
'@forinda/kickjs-ai': patch
'@forinda/kickjs-auth': patch
'@forinda/kickjs-cli': patch
'@forinda/kickjs-db': patch
'@forinda/kickjs-db-pg': patch
'@forinda/kickjs-devtools': patch
'@forinda/kickjs-devtools-kit': patch
'@forinda/kickjs-drizzle': patch
'@forinda/kickjs-lint': patch
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-prisma': patch
'@forinda/kickjs-queue': patch
'@forinda/kickjs-swagger': patch
'@forinda/kickjs-testing': patch
'@forinda/kickjs-vite': patch
'@forinda/kickjs-ws': patch
---

Minify published build output via the tsdown / oxc minifier.

- **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
- **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.
