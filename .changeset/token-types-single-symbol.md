---
'@forinda/kickjs-ws': patch
'@forinda/kickjs-queue': patch
'@forinda/kickjs-grpc': patch
'@forinda/kickjs-mcp': patch
---

`WS_ROOM_MANAGER`, `QUEUE_MANAGER`, `GRPC_ADAPTER`, `MCP_ADAPTER` and the other tokens these packages export now type-check with `container.resolve()` and `@Inject()`. Their published types no longer carry a private copy of `InjectionToken`, so an `as never` cast around them can go.
