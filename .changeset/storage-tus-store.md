---
'@forinda/kickjs-storage': minor
---

- **Unfinished uploads in any `Storage`.** `TusAdapter` keeps unfinished uploads in `partials`, which can be any `Storage` (a local `diskStorage` by default). With a shared bucket, every instance can take any request of any upload, with no sticky sessions. Chunks commit through `putIfAbsent` markers, so two requests racing for one offset keep exactly one.
- **Disconnects keep received bytes.** A client that disconnects mid-PATCH keeps the bytes that arrived.
- **New tus extensions:** checksum (`Upload-Checksum` with sha1, sha256 or md5, and 460 on a mismatch) and concatenation (parallel uploads, as with tus-js-client's `parallelUploads`).
