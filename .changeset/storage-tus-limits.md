---
'@forinda/kickjs-storage': patch
---

tus: an upload takes at most 10,000 PATCH requests, and each instance keeps at most 1,000 uploads in its commit cache. With shared partials, an instance that served part of an upload but never saw it finish used to keep its cache entry forever.
