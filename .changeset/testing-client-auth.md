---
'@forinda/kickjs-testing': minor
---

The test client's `.as(credential)` isn't bearer-only any more: `client({ auth: (sid) => ({ cookie: `sid=${sid}` }) })` (or an API-key header, or any scheme) sets what `.as()` sends. Without `auth`, it's `Authorization: Bearer <credential>` as before.
