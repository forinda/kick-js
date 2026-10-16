---
'@forinda/kickjs-cli': minor
---

Tests written by `kick g module` and `kick g test` import from `vite-plus/test` when the project depends on `vite-plus` and not `vitest` — what `vp migrate` leaves — and from `vitest` otherwise. New guide: Using Vite+.
