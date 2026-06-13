---
'@forinda/kickjs-cli': patch
---

`kick add ws` now installs the correct peer dependency. The catalog listed `socket.io`, but `@forinda/kickjs-ws` is built on the `ws` package (`WebSocketServer`) — adopters running `kick add ws` got the wrong library. Fixed the registry entry to `ws`.
