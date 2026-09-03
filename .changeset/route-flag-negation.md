---
'@forinda/kickjs': minor
---

Negated route-flag tests: `'!auth.public'`.

Every `skipWhen` / `onlyWhen` / `exemptWhen` now accepts a name with `!` in front, matching routes that do **not** carry the flag:

```ts
rateLimitGuard({ max: 60, exemptWhen: '!billing.metered' }) // exempt everything unmetered
```

Previously the only way to express that was a predicate. It matters most on `exemptWhen`, which has no `onlyWhen` counterpart — `skipWhen: '!x'` is just `onlyWhen: 'x'` written differently.

A list stays single-polarity, and the type enforces it:

```ts
;['auth.public', 'health.probe'] // carries ANY of these
;['!auth.public', '!health.probe'] // carries NONE of these
;['auth.public', '!health.probe'] // compile error
```

Mixed polarity would mean "public present **or** probe absent" under any-of, which most readers parse as "and" — so instead of picking a reading, the type rejects it and a predicate expresses the compound case. Mixing at runtime (from untyped config) throws where the consumer is constructed rather than on the first request that reaches it.

Negated names narrow with `KickRouteFlags` like positive ones, so `'!auth.pubic'` is a compile error too.
