---
'@forinda/kickjs': patch
---

`session()` with a store saves the session before the response goes out, not after. With a slow store such as Redis, the request right after a form post (the redirect) could otherwise read the session before the write landed and miss the flashed errors and messages. On a Node response (Express, Fastify, h3), `end()` now waits for the store's write, for at most `saveTimeout` ms (new option, default 5000); a failed or stalled write is logged and the response still goes out. The fetch entry still saves after the response. The cookie store, which writes the cookie before the headers, is unchanged.
