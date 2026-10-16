---
'@forinda/kickjs-storage': minor
---

`StorageAdapter` reports to `/health/ready`: its `onHealthCheck()` lists one key (`list({ limit: 1 })`), so an unreachable bucket or rejected credentials mark it `down`. With S3, the credentials need list permission on the bucket for the check to pass.

Migration: if your S3 credentials can't list the bucket, `/health/ready` now reports the storage `down` — grant `s3:ListBucket`, or pass `healthCheck: false` to `StorageAdapter`.
