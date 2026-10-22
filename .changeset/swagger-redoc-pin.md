---
'@forinda/kickjs-swagger': patch
---

`/redoc` renders again. The page loaded Redoc's `latest` bundle, which is now Redoc 3, whose standalone script uses `import.meta` and throws as a classic `<script>`. It now loads `redoc@2` from jsDelivr, and the CSP allows only that CDN for ReDoc, plus `worker-src 'self' blob:` for its search worker.
