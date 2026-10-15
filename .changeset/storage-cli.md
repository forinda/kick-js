---
'@forinda/kickjs-storage': minor
'@forinda/kickjs-cli': minor
---

- **`StorageAdapter`** (from `@forinda/kickjs-storage/adapter`). It binds a storage to the `STORAGE` token, or a token of your own via `.scoped()`. For a storage from `s3FromSettings()`, it also declares that storage's settings section.
- **`kick add storage` and `kick new --packages storage` now wire the package.**
  - They write `src/storage.ts`, which uses the `uploads/` folder until `S3_BUCKET` is set and then that bucket.
  - They add `storageAdapter()` to `bootstrap()`, the `S3_*` variables to `.env.example`, and `uploads/` and `.tus/` to `.gitignore`.
