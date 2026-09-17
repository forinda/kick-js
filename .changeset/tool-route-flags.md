---
'@forinda/kickjs': minor
'@forinda/kickjs-mcp': minor
'@forinda/kickjs-ai': minor
---

Route flags decide which routes become MCP and AI tools.

- `McpAdapter` and `AiAdapter` take `exposeWhen` and `hideWhen`, in the same forms as `skipWhen` (a name, `'!name'`, a list, or a predicate). A route carrying an `exposeWhen` flag becomes a tool without `@McpTool` / `@AiTool` — on a method, a controller, or a module mount. `hideWhen` wins over the decorators, `exposeWhen` and MCP's `mode: 'auto'`, so a module can hide a controller it mounts but does not own.
- A flag whose value is an object supplies tool options (`description`, `name`, and for MCP `hidden`), e.g. `defineRouteFlag<Partial<McpToolOptions>>('mcp.tool')`. The decorator on the method takes precedence.
- A mixed-polarity flag list throws when the adapter is created.
- `matchesFlagTest` is now exported from `@forinda/kickjs`, so packages evaluate flag tests the same way the framework does.
