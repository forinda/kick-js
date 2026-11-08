---
'@forinda/kickjs-storage': patch
---

S3 buckets retry what the AWS SDK retries:

- 429
- S3's 400 `RequestTimeout`
- a clock-skew error. The storage then signs with the bucket's time from then on, signed URLs included. A `HEAD` (`stat`, `exists`) carries no error code, so a 403 whose `Date` is more than 15 minutes off counts as skew.
- a CopyObject, UploadPartCopy or CompleteMultipartUpload that answers 200 with an error or with no body. An empty 200 used to count as success. Two exceptions:
  - `PreconditionFailed`, a create-only write losing the race, is an answer, not a failure.
  - A create-only (`putIfAbsent`) completion that fails this way isn't retried, since the write may have happened. It's reported as a failure, and the upload is aborted.

`putIfAbsent` is retried only when S3 refused it before writing: 503, 429, `RequestTimeout`, clock skew.

`get` and `getStream` return a file stored with `contentEncoding: 'gzip'` as stored: `fetch` decompressed it before. Header values with runs of spaces are signed as S3 checks them.
