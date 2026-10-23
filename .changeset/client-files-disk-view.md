---
'@forinda/kickjs-view': minor
---

Client files on disk. A bundle's `client.disk` lists files the build wrote to disk; `createViews({ clientDir })` (from `virtual:kick-views`) points at their folder. The Node entry serves them, bytes and all, with their content type (`views.clientFile(file)`); only listed names are ever read. The edge entry has no reader, so those requests fall through to the platform's static files. `useClientFiles(read)` sets the reader.
