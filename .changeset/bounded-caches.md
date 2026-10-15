---
'@forinda/kickjs': patch
'@forinda/kickjs-db': patch
'@forinda/kickjs-ws': patch
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-devtools': patch
'@forinda/kickjs-ai': patch
---

Bound long-lived state that client input could grow without limit:

- **kickjs**
  - The in-memory `rateLimit()` and `rateLimitGuard()` stores cap at 100,000 keys. Expired windows are dropped from the front without a full scan. When the store is still full, a new key is refused (429) instead of evicting a live counter, which would let a flood of keys reset another client's count.
  - The in-memory session store caps at 10,000 sessions. Empty ones (what a cookieless flood creates) are evicted first, then the least recently written.
  - Metrics label unknown HTTP methods `OTHER`.
- **kickjs-db**
  - Computed-field (`$extends({ result })`) bookkeeping no longer keeps an entry for every failed query.
  - The `'schema'` tenancy strategy no longer caches a plugin per schema name.
  - `maxOpenTenants` defaults to 100 instead of unlimited.
- **kickjs-ws:** `join()` is ignored for a socket that already closed (with ws and Socket.IO), and a socket can be in at most 1,000 rooms.
- **kickjs-mcp:** a session's idle timer starts as soon as it exists, so a session whose first response fails still expires. Initializations in progress count toward `maxSessions`.
- **kickjs-devtools:** route latency keys use `OTHER` for unknown methods.
- **kickjs-ai:** `AnthropicProvider` remembers at most 100 warned-about model names.
