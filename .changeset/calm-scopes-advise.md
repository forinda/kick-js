---
'@forinda/kickjs': patch
'@forinda/kickjs-cli': patch
---

The REQUEST-into-SINGLETON error now gives advice the parent can follow.

It said "Use TRANSIENT or REQUEST scope for the parent" for every parent. A
`@Controller()` takes no options and is always SINGLETON, so for the most
common case — a controller constructor injecting a request-scoped repository —
the suggested fix did not exist (#676). A controller parent is now told to
inject the dependency with `@Autowired()`, which re-resolves REQUEST-scoped
dependencies per access; any other parent is told it can change its scope or
use `@Autowired()`. The message still starts with `Cannot inject REQUEST-scoped
"…" into SINGLETON "…"`, so `kick explain` matches it as before, and its
diagnosis no longer quotes the old wording as current.
