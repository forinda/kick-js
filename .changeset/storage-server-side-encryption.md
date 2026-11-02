---
'@forinda/kickjs-storage': minor
---

`s3Storage({ serverSideEncryption })` encrypts what the storage writes, with keys S3 manages (`{ type: 'AES256' }`) or a KMS key (`{ type: 'aws:kms', keyId? }`). The signed headers go on `put`, `putIfAbsent`, `compose`, `multipart.create` and `uploadForm`; `uploadUrl` doesn't carry them.
