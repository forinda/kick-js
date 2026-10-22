---
'@forinda/kickjs-vite': minor
---

`kick build` strips the TypeScript from each component's `<script client>` (with `transformWithOxc`) and ships plain JS in the views bundle, so edge runtimes serve it without stripping anything.
