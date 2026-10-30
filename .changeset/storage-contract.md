---
'@forinda/kickjs-storage': minor
---

Write your own storage driver. `@forinda/kickjs-storage/testing` exports `storageContract(name, make, { skip?, baseUrl? })`, the Vitest suite the built-in drivers run, so a driver for another service (Cloudinary, Azure Blob, an internal file API) can be checked against the same behaviour; `skip` leaves out what a backend deliberately can't do. The checks every driver makes are exported too, so a custom one throws the same errors: `checkKey`, `checkRange`, `checkLimit`, `checkDelimiter`, `collect` and `encodeKey`. The file storage guide has a new "Your own driver" section with the rules each method keeps and an example driver. `vitest` is an optional peer, needed only for `/testing`.
