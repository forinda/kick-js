---
'@forinda/kickjs-storage': minor
---

S3 buckets:

- **Retries:** a request that can't connect, times out, or gets 500/502/503/504 is sent again with backoff, up to `maxAttempts` (default 3; `1` turns retries off), as the AWS SDK does. `putIfAbsent` is retried only on 503, so a write that may have landed isn't reported as taken.
- **Per-file headers and metadata:** `cacheControl`, `contentDisposition`, `contentEncoding`, `contentLanguage` and `metadata` (`x-amz-meta-*`) on `put`, `putIfAbsent`, `compose`, `multipart.create`, `uploadUrl` and `uploadForm`. `stat()` returns them.
