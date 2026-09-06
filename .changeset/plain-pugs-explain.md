---
'@forinda/kickjs-cli': patch
---

`kick explain` now recognizes the framework's own DI errors: the REQUEST-into-SINGLETON scope violation, `Circular dependency detected`, `No provider for <token>` (KICK001), and the dev-server 404 that means the entry file exports no `app`.

The scope entry notes what the runtime error cannot: `@Controller()` takes no `scope` option, so "use TRANSIENT or REQUEST scope for the parent" has no controller-shaped answer — `@Autowired` is the fix there.
