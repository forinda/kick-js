---
'@forinda/kickjs': minor
'@forinda/kickjs-vite': minor
'@forinda/kickjs-cli': minor
---

Static files are served compressed. `SpaAdapter`, the Inertia adapter and `ctx.http.serveStatic()` send a file's `.br` or `.gz` copy to a browser that accepts it (Brotli first), with `Vary: Accept-Encoding` and the original `Content-Type`, on Express, Fastify and h3. `compressAssets()` from the new `@forinda/kickjs-vite/compress` writes the copies when the client is built, and `kick new --template fullstack` and `--template inertia` projects use it. `@forinda/kickjs-vite` no longer requires `@forinda/kickjs`, so a client package can use the plugin on its own.
