---
'@forinda/kickjs': patch
---

`@forinda/kickjs/web` (`createWebApp`) answers a refused upload — a file type the route doesn't allow, or a file over its size limit — with KickJS's problem details (`415` / `413` with a `detail`), as the other runtimes do, instead of the host's bare error.
