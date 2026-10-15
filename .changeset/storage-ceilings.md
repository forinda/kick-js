---
'@forinda/kickjs-storage': minor
---

- **`S3Storage.compose(key, sources)`** joins objects inside the bucket, using CopyObject, or UploadPartCopy in even ranges of at most 5 GiB. It streams through when an earlier source is under S3's 5 MiB part minimum. `S3Storage.location` identifies the bucket.
- **tus finishing with `compose`.** When `storage` and `partials` are the same bucket, `TusAdapter` joins a finished upload's chunks with `compose`, so the bytes don't pass through the server.
- **tus cleanup.** The tus sweep walks an expiry index (`tus/_expiry/<hour>/<id>`) and reads only uploads that may have expired.
- **Streamed `putIfAbsent`.** A stream body is no longer read into memory. Buckets upload it in parts and make completion the conditional step, and disk streams it to a temp file before the atomic link.
- **Disk listing.** `diskStorage.list()` keeps each folder's sorted listing until the folder changes, and uses a binary search for the cursor. Paging through a huge folder reads it once.
