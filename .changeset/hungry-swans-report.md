---
'@forinda/kickjs': patch
---

`trustProxy` now works on the h3 runtime, and the rate-limit key is documented
as what it is.

Reported as `rateLimitGuard`'s default `keyGenerator` ignoring
`x-forwarded-for` (#614). The keying behaviour is correct and deliberate — but
two real problems sat behind the report.

**The doc comment described a different implementation.** It promised
`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` → `'global'`. The default
is `ctx.ip`, and `resolveClientIp` consults forwarded headers only where there
is no socket — the `@forinda/kickjs/web` edge entry. On a node runtime it uses
the address the engine vetted against its own trust-proxy setting, then the
socket.

That ordering is the safe one: `x-forwarded-for` is client-controllable unless
a proxy overwrites it, so believing it unconditionally would let a direct caller
mint a fresh allowance per request by varying the header — evading the limiter
rather than being held by it. The comment now says that, and says plainly that
behind a proxy you must set `trustProxy` or every client shares one bucket.

**`trustProxy` was silently ignored on h3.** Express derives `req.ip` from
`trust proxy` and Fastify from `trustProxy`; h3's `createApp` took the option
and dropped it (`_options`), so `resolveClientIp` fell through to the socket no
matter what the app configured. Behind a load balancer that is one bucket for
every caller, with no way to configure out of it — a rate limiter that protects
nothing, failing quietly, because in development each client really does have
its own address.

h3 now derives `req.ip` from the first `x-forwarded-for` hop when — and only
when — `trustProxy` is set, matching what the other two engines do with their
own settings.

Pinned across all three runtimes: an untrusted `x-forwarded-for` cannot mint
buckets, and a configured proxy buckets per client.
