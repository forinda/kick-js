---
'@forinda/kickjs-cli': minor
---

Add `kick g contributor <name>` to scaffold a Context Contributor.

- `--type http` (default) → `defineHttpContextDecorator`, resolver typed against `RequestContext`.
- `--type bare` → `defineContextDecorator`, resolver typed against the transport-agnostic `ExecutionContext`.
- `--params "source:string,region:number"` → emits the curried `.withParams<T>()` form with a generated params `type` alias and `paramDefaults` stub (mirrors how `kick g scaffold` takes field definitions).
- `--key <key>` overrides the context key (defaults to camelCase of the name); `-m <module>` scopes the file into a module folder.

The scaffold also drops a `ContextMeta` augmentation stub so `ctx.get('<key>')` is typed and `dependsOn: ['<key>']` is checked.
