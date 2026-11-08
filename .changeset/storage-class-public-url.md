---
'@forinda/kickjs-storage': minor
'@forinda/kickjs-cli': patch
---

S3 buckets: `storageClass` (`'STANDARD_IA'`, `'GLACIER_IR'`, …) on the storage and on each write, returned by `stat()`; and `publicUrl(key)`, the unsigned address of a public file, from the bucket or a `publicUrl` option such as a CDN. `S3Settings` reads `S3_STORAGE_CLASS` and `S3_PUBLIC_URL`, and the `kick add storage` `.env.example` lists them.
