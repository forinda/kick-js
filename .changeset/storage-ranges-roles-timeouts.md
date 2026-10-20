---
'@forinda/kickjs-storage': minor
---

Ranged reads, IAM roles, timeouts and response headers on signed URLs.

- `getStream(key, { start, end })` reads part of a file, for answering HTTP `Range` requests: `createReadStream` with `start`/`end` on disk, a `Range` header on a bucket, a slice in memory.
- `s3Storage({ credentials })` takes a function that returns the current keys, instead of fixed `accessKeyId` / `secretAccessKey`, so an app on ECS, EC2 or EKS can use its role (`fromNodeProviderChain()` from `@aws-sdk/credential-providers`). `S3Settings` now accepts both keys unset; setting only one still fails startup.
- `s3Storage({ timeoutMs })` aborts a request the bucket hasn't answered in time, so a slow bucket fails the route instead of hanging it.
- `url(key, { contentType, contentDisposition, cacheControl })` signs S3's `response-*` parameters into the URL, so the bucket serves the file with those headers.
- `diskStorage` reads of a key reached through a symbolic link now return `null` (a 404) instead of throwing. Writes through a link still throw.
