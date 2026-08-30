---
'@forinda/kickjs-cli': patch
---

typegen: carry values through key-remapped mapped types in the client route map

A handler returning a mapped type with an `as` clause emitted the remapped keys
correctly and `any` for every value:

```ts
type CamelizeKeys<T> = { [K in keyof T as Camel<K>]: T[K] }

// was:  { contactName: any; schoolCount: any }
// now:  { contactName: string; schoolCount: number }
```

Key remapping produces _synthesized_ properties, which have no declaration at
all. The expander fell back to `getDeclaredTypeOfSymbol` for those — a function
that answers for type symbols (aliases, interfaces, classes) and returns the
error type when handed a property. `getTypeOfSymbol` answers for both kinds and
is now used throughout. The homomorphic form (`{ [K in keyof T]: T[K] }`) only
ever worked by accident: its properties keep a declaration pointing back at the
source property.

`any` was the worst available degradation here — `unknown` forces a cast at the
call site, `any` silently type-checks against anything — so a route returning a
remapped DTO was less safe than one still emitting `unknown`. On a real
1,940-route app this removes all 66 `any` fields.
