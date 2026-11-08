---
'@forinda/kickjs-storage': minor
'@forinda/kickjs-cli': patch
---

`acl` for S3 buckets: a canned ACL (`'public-read'`, …) sent, signed, on every write a storage makes — `put`, `putIfAbsent`, `compose`, `multipart.create`, `uploadForm` and `uploadUrl` (signed into the URL). Each of those also takes its own `acl`, over the storage's. `S3Settings` reads it from `S3_ACL`.

`s3Configured(section?)` from `@forinda/kickjs-storage/settings`: true when the section's bucket is set (`S3_BUCKET` or `S3_BUCKET_FILE`). The `kick add storage` file now picks its driver with it instead of reading `process.env.S3_BUCKET`, which missed a bucket kept in a secret file.
