---
'@forinda/kickjs-storage': minor
'@forinda/kickjs-testing': minor
---

Storage adds `list({ prefix, cursor, limit })`, `stat()` and `getStream()`, and `put()` takes a stream: disk writes it as it arrives, buckets upload it in 5 MiB parts. `s3Storage` adds uploads that go from the browser straight to the bucket. `uploadUrl(key, { size, contentType })` signs the exact size and type into the URL. `multipart` provides `create`, `partUrl`, `listParts`, `complete` and `abort` for large, resumable uploads (Uppy-compatible). `startService('minio')` starts an S3-compatible MinIO with a `test` bucket, and `startContainer` takes `entrypoint` and `command`.
