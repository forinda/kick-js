---
'@forinda/kickjs-cli': patch
---

`kick g scaffold` validates string fields like `kick g module` does: `title:string` emits `z.string().min(1).max(200)` and `body:text` emits `z.string().min(1)` in the create DTO (the update DTO is the same with `.optional()`), so a create body with an empty string is rejected with 422 instead of stored.
