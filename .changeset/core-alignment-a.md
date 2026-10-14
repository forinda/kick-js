---
'@forinda/kickjs': patch
---

Runtime alignment fixes:

- `csrf()` compares the header token to the cookie in constant time.
- On h3 and the web entry, route params are percent-decoded like on Express and Fastify (`/users/a%20b` gives `'a b'`); a malformed escape answers 400.
- On Fastify, `trustProxy` keeps Express semantics: a function is honoured (it was dropped), and a hop count trusts that many proxies (Fastify read it as "trust none").
- On Fastify, a handler that neither writes a response nor returns a value answers 404, as on h3, instead of an empty 200.
