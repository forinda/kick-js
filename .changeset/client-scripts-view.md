---
'@forinda/kickjs-view': minor
---

Components with a script. A component's top-level `<script client>` holds TypeScript for the browser. A page that renders the component gets one `<script type="module" src="/_kick/c/<tag>.<hash>.js">` for it before `</body>`, with `nonce` from `cspNonce`. A page that renders none gets no JavaScript. `KickView` serves the scripts with long-lived caching. On the web fetch entry, `clientScriptResponse(views, request)` serves them ahead of the router. Types are stripped by `kick build`, or at runtime with Node 22.13+'s stripper, registered by the Node entry only, so edge bundles don't reference `node:module`. Scripts are self-contained for now (no `import`), only in components, at most one each. `createViews` takes `clientScriptPath` and `stripTypes`.
