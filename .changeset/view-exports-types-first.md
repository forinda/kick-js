---
'@forinda/kickjs-view': patch
---

The `./file-loader` and `./cli` exports list `types` before `import`, so TypeScript resolves their types under every module resolution mode.
