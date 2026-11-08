---
'@forinda/kickjs-storage': patch
---

S3 buckets retry what the AWS SDK retries:

- 429
- S3's 400 `RequestTimeout`
- a CopyObject, UploadPartCopy or CompleteMultipartUpload that answers 200 with an error or with no body; an empty 200 used to count as success

After a clock-skew error, the storage signs with the bucket's time from then on, signed URLs included.
