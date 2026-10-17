---
'@forinda/kickjs': patch
---

Security: upload routes stop reading at their limits on every runtime. On Fastify, `@fastify/multipart` was registered with no file-size limit, and on h3 and the web entry `request.formData()` read the whole body, so each file was buffered in full before `maxSize` was checked. A large upload to any `@FileUpload` route could exhaust memory. Now Fastify's parser gets each route's limits, and h3 and the web entry read at most `maxSize × files` plus about 1 MB of form fields before parsing. More files than a route takes is a `413` ("Too many files: at most N") on every runtime; extra files used to be dropped silently.

A request body with a `__proto__` or `constructor.prototype` key, whether JSON, urlencoded or multipart, is refused with `400` on Express and h3 too, as Fastify already did. Such a key was harmless in `ctx.body`, but it turned `Object.assign(target, ctx.body)` or a naive deep merge into prototype pollution.

Repeated multipart field names become arrays on Fastify and h3, as they already did for urlencoded forms.
