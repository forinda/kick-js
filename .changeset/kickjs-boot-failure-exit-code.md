---
'@forinda/kickjs': patch
---

A process that ends after an uncaught exception or unhandled rejection now exits with code 1. KickJS's own listeners for both replace Node's handling, which exits with 1, so a boot that threw — `await bootstrap()` rejecting because an adapter refused to start — ended the process with 0, and a deploy read the crash as success. A running server still logs the error and keeps serving, as before.
