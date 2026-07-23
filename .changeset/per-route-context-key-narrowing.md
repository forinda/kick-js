---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
---

Per-route context-key narrowing — a dropped contributor decorator is now a compile error.

`kick typegen` emits a `contextKeys` union per route from the context decorators applied at method and class level, and `ctx.require()` is narrowed to it. Removing a decorator removes the key:

```text
error TS2345: Argument of type '"operatorPerm"' is not assignable to parameter of type '"tenant"'.
```

That refactor was previously invisible to `tsc` — `ctx.get('operatorPerm')!` compiled whether or not the decorator was applied, and the handler read `undefined` into an authorization check.

**`ctx.get()` is deliberately not narrowed.** The original design (`architecture.md` §20.14) proposed dropping `| undefined` from `get()` for keys typegen believes are present. That was not built, because the two options fail in opposite directions: narrowing `get()` wrongly produces a value the types promise and the runtime doesn't deliver — silent, fails open, the exact failure this line of work removed. Narrowing `require()` wrongly produces a compile error — loud, fails closed, and covered by an escape hatch.

**Narrowing applies only where completeness is provable.** A route gets a key union only when every decorator on it is either a known contributor-free framework decorator or a resolvable context decorator. Typegen emits `string` (no narrowing, today's behaviour) for an unrecognised decorator — adopter decorators can bundle contributors of their own — an unresolvable import, an ambiguous binding name, a route recovered by the regex fallback, or the presence of **any** contributor registered at module / adapter / bootstrap level, since a global registration adds keys to routes that carry no decorator for them. `never` is distinct from `string`: it means the scanner proved the route carries no contributors, so `require()` on it really is a mistake.

**Escape hatch:** type the handler as plain `RequestContext` rather than `Ctx<KickRoutes…>` — `TKeys` defaults to `string` and no narrowing applies.

API changes, both source-compatible: `RequestContext` gains a fourth type parameter `TKeys extends string = string`, and `ExecutionContext` becomes `ExecutionContext<TKeys extends string = string>`. Existing annotations keep working — the defaults reproduce today's behaviour exactly. `RouteShape` gains an optional `contextKeys` member.

Module, adapter, and bootstrap registration sites are detected but not yet resolved; resolving them (so a module-scoped contributor narrows instead of degrading the project) is the next increment.
