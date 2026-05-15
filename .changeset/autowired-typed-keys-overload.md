---
'@forinda/kickjs': patch
---

fix(core): restore typed `KickJsRegistry` overload on `@Autowired`

The first overload — `<K extends keyof KickJsRegistry & string>(token: K)` —
already exists on `@Inject` but was lost on `@Autowired` during the
dual-position unification in forinda/kick-js#236. Without it, adopters lose
string-literal narrowing + typo detection when reaching for `@Autowired`
instead of `@Inject`, even though the two are interchangeable everywhere
else.

After `kick typegen` populates the registry, `@Autowired('kick/prisma/Client')`
now autocompletes the key and typo'd literals become TS2345 errors, matching
`@Inject` exactly. No runtime behaviour change.
