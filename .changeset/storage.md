---
'@forinda/kickjs-storage': minor
'@forinda/kickjs-cli': minor
---

New package `@forinda/kickjs-storage`: one `Storage` interface (`put`, `get`, `exists`, `delete`, `url`) over `memoryStorage()`, `diskStorage({ root, baseUrl })` and `s3Storage({ bucket, region, endpoint, forcePathStyle, ... })`. The S3 driver works with AWS S3, Cloudflare R2 and MinIO, signs its requests with SigV4 over `fetch` (no AWS SDK), and returns presigned URLs from `url()`. Keys that could escape the disk root or alias another object are refused. `@forinda/kickjs-storage/settings` adds an `S3Settings` section and `s3FromSettings()`. `kick add storage` installs it.
