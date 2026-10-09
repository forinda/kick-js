---
'@forinda/kickjs-cli': patch
---

Generated DTOs use Zod 4's top-level string formats: `date` fields emit `z.iso.datetime()`, and `email`, `url` and `uuid` emit `z.email()`, `z.url()` and `z.uuid()`. The old `z.string().datetime()` / `.email()` / `.url()` / `.uuid()` forms are deprecated in Zod 4. The scaffolded `src/config/index.ts` examples use `z.url()` too.
