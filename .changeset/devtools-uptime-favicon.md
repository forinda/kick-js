---
'@forinda/kickjs-devtools': patch
---

Uptime keeps counting. It was a `computed()` over the process clock, which is not reactive, so it cached its first read and the Overview, Topology and `/_debug/health` showed the same few seconds forever.

The dashboard ships its own favicon, so opening `/_debug` no longer requests `/favicon.ico` from the app — that 404 showed up in Requests and Recent failures.
