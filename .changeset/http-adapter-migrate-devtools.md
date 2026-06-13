---
'@forinda/kickjs-devtools': patch
---

Migrate the devtools adapter off the raw Express `app` / `Router` onto the engine-agnostic `ctx.http` facade (final M2 adapter). A thin local `router` shim forwards `.get` / `.post` / `.use` to `ctx.http.route` / `ctx.http.use`, so every dashboard handler — the ~20 JSON routes, the SSE streams, the heap-snapshot download, the static dashboard, and the token guard — is kept verbatim. Registration order is preserved and the guard still sees router-relative `req.path` (the facade scopes it to `basePath`, and Express strips the prefix), so behavior is unchanged under the default Express runtime. `ctx.app` is still used only as the documented escape hatch for `__kickApp` (topology needs the live Application instance).
