---
'@forinda/kickjs-cli': patch
---

`kick g adapter`: scaffold every hook on `AppAdapter`, and stop calling the
middleware hook Express-only.

The scaffold emitted 7 of the 10 hooks while its own comment promised "every
lifecycle hook below is OPTIONAL. The scaffold emits all of them so adopters can
browse what's available". `onHealthCheck`, `introspect` and `devtoolsTabs` were
missing entirely.

`onHealthCheck` is the costly omission: it is the one hook with a built-in
consumer, since `Application` aggregates every adapter's check through
`Promise.allSettled` and serves the result at `GET /health/ready`. Undiscoverable
from the generator, adopters wrote their own readiness endpoints instead of
contributing a check to the built-in one. `introspect` and `devtoolsTabs` feed
DevTools and had the same problem.

Each new hook names its consumer, so the scaffold says what the hook is _for_
rather than only that it exists. `onHealthCheck` ships uncommented and compiles
as generated; the two DevTools hooks are commented out like their neighbours,
since `devtoolsTabs` needs an import from `@forinda/kickjs-devtools-kit`.

The middleware hook's comment said "Express middleware entries" on every
project, including one configured for Fastify or h3. It now says connect-style,
which is accurate on all three engines.

A new test pins the full hook list against `AppAdapter`, so the scaffold cannot
silently fall behind the interface again.
