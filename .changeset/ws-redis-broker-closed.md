---
'@forinda/kickjs-ws': patch
---

`redisBroker().close()` no longer fails with `Connection is closed.` on shutdown when the app has already quit the subscriber connection in its own cleanup (adapters shut down concurrently). A closed connection holds no subscription, so the unsubscribe is skipped.
