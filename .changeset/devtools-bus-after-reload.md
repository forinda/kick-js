---
'@forinda/kickjs-devtools': patch
---

The DevTools event bus keeps working after a dev reload. `Container.reset()` carried the closed bus over to the new app, so `/_debug/_bus` refused every connection until the server restarted, which left the Activity tab and other live updates quiet. A generated token now also lasts for the whole process, so a dashboard left open stays signed in across reloads.
