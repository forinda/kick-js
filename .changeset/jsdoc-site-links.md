---
'@forinda/kickjs-ai': patch
'@forinda/kickjs-cli': patch
'@forinda/kickjs-cli-kit': patch
'@forinda/kickjs-db': patch
'@forinda/kickjs-devtools': patch
'@forinda/kickjs-devtools-kit': patch
'@forinda/kickjs-di': patch
'@forinda/kickjs-grpc': patch
'@forinda/kickjs-inertia': patch
'@forinda/kickjs': patch
'@forinda/kickjs-lint': patch
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-queue': patch
'@forinda/kickjs-storage': patch
'@forinda/kickjs-swagger': patch
'@forinda/kickjs-testing': patch
'@forinda/kickjs-view': patch
'@forinda/kickjs-ws': patch
---

JSDoc and messages now link https://kickjs.app instead of repo files and design-note sections.

- Every public decorator and adapter has JSDoc with a `@see` link to its guide, shown on hover. New JSDoc for `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`, `@Cacheable`, `@CacheResponse`, `KickCronAdapter`, `InertiaAdapter`, `StorageAdapter`, `KickView` and `SocketIoAdapter`.
- JSDoc that a statement had separated from its export is back on it, so editors show it: `session`, `DevToolsAdapter`, `defineTenancy`, `ContextMetaKey`, `VIEW_RENDERER`, `ResolvedRelation`, `useFileLoader`, `useStripTypes`, `useClientFiles`.
- Messages that pointed at design-note sections or `guide/…` paths now give the page's URL: `defineModule` and `defineContextDecorator` option errors, kick-lint's token suggestion, and `kick` runtime swap's manual-step note.
