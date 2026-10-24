---
'@forinda/kickjs': patch
'@forinda/kickjs-ws': patch
---

Dev reloads no longer overlap. Saving again before the last reload finished ran two boots at once: an app shut down mid-start still attached its adapters (socket.io stayed on the server for good), and a `Container.reset()` from one boot swapped the container under the other, so lookups failed with "No provider for …". Boots now run one at a time, and a second `shutdown()` call waits for the first. `SocketIoAdapter` teardown that finishes after the next adapter attached no longer leaves the app's request handler on the server twice (every request — CSS from Vite included — answered twice until a restart).
