---
'@forinda/kickjs-cli': minor
---

`kick check --di` finds REQUEST-scoped dependencies injected through the
constructor of a SINGLETON — including every controller — before anything runs
(#676).

The container rejects that pairing only when it first builds the parent, which
for a controller is the first request that reaches it: the route mounts, boots,
and answers 500. Both scopes are in the source, so the check reports the
constructor parameter's file and line, with the same advice the container gives
(`@Autowired()` for a controller; a different scope or `@Autowired()` for
anything else), and exits non-zero.

Scopes are read from `@Service` / `@Repository` / `@Component` /
`@Injectable({ scope })` and `container.register` / `registerFactory` calls;
parameters resolve through `@Inject(token)` or their class type. The scan
reports nothing it cannot pin down — a scope in a variable, a name declared in
two files, a token registered under two scopes — so a finding is a real failure.
`--deploy` and `--di` can be combined.
