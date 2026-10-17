---
'@forinda/kickjs-swagger': patch
'@forinda/kickjs-grpc': patch
'@forinda/kickjs-vite': patch
---

`@forinda/kickjs-swagger` and `@forinda/kickjs-vite` no longer require `express`, and swagger's and grpc's typings no longer need `@types/express`, so an app on Fastify or h3 installs without either.
