---
'@forinda/kickjs-storage': minor
---

`ensureBucket()` on an S3 storage creates the bucket when it's missing, returning `true` when it did. It names the region outside `us-east-1`, treats a concurrent create as success, and throws when the name is taken by another account or access is denied. Useful for a fresh MinIO in development and tests.
