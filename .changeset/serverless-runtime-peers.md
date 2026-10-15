---
'@forinda/kickjs': patch
---

Fastify and h3 apps work on Netlify and Vercel. `kick build:netlify|vercel` bundles the app into one file, but the runtimes loaded `fastify`, `h3`, `@fastify/middie`, `@fastify/multipart`, `serve-static` and `multer` through `createRequire`. A bundler leaves those calls in place, and the deployed function has no `node_modules`, so every request failed with "Cannot find module 'fastify'" (or 'h3'). Express uploads (`multer`) failed the same way. They now load through `import`, which the bundle inlines: `fastify` and `h3` statically in their own runtime entries, the rest when first used. A missing `multer` is now reported on the first upload request rather than when the route is built. `h3` is now declared as an optional peer dependency (`^2.0.0`), as `fastify` already was, so strict installs (pnpm) link it where `@forinda/kickjs/h3` can resolve it.
