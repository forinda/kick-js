---
'@forinda/kickjs-view': patch
---

The `./file-loader` and `./cli` exports list `types` before `import`, so TypeScript finds their types under the resolution modes that read `exports` (`node16`, `nodenext`, `bundler`).
