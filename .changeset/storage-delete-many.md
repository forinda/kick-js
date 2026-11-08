---
'@forinda/kickjs-storage': minor
---

`deleteMany(keys)` on S3 buckets: up to 1000 files per request (DeleteObjects) instead of one request each. Missing keys count as deleted; keys the bucket refuses are named in the error.
