---
'@forinda/kickjs-storage': minor
'@forinda/kickjs': minor
---

`@forinda/kickjs-storage/tus` adds `TusAdapter`: a tus 1.0.0 endpoint (creation, creation-with-upload, termination, expiration) for resumable uploads through your own server, with tus-js-client, Uppy and other tus clients. Unfinished uploads are written to a local directory as they arrive, and completed files move into any `Storage`. `onCreate`, `authorize` and `onComplete` hooks check who uploads what and record the result. It works on Express, Fastify and h3.

`@forinda/kickjs` exports `RAW_BODY` (`Symbol.for('kick/http/raw-body')`). Middleware that reads the request stream itself sets it in an adapter's `beforeGlobal` phase, so the Express 415 for unparsed body types leaves that request alone.
