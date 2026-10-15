---
'@forinda/kickjs-storage': minor
---

- **Folders in listings.** `list({ delimiter: '/' })` groups keys into folders and returns them in `prefixes`, with S3's `CommonPrefixes` semantics, on memory, disk and buckets. Files and prefixes page together.
- **`S3Storage.uploadForm(key, { maxSize, minSize, contentType })`** signs a browser form upload (POST policy). The bucket enforces the size range, the key, and the content type or type family (`'image/'`), so the browser doesn't need to declare the size first. Supported on AWS S3 and MinIO, not on Cloudflare R2.
