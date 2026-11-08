---
'@forinda/kickjs-storage': minor
---

`deleteMany(keys)` on S3 buckets: up to 1000 files per request (DeleteObjects) instead of one request each, with the `Content-MD5` every S3 API accepts. Missing keys count as deleted. The error names keys the bucket refuses, those of earlier batches included when a later request fails.
