---
'@forinda/kickjs-devtools-kit': minor
'@forinda/kickjs-devtools': minor
---

Custom tabs can run server code and render live content.

- **`launch` buttons work:** an action's new `run()` executes on the server when its button is clicked, and the dashboard shows what it returns (or the error). Before, every button posted to a route nothing served and got a 404.
- **`module` view:** `view: { type: 'module', src }` loads a browser module from the app's own origin and mounts its default export — a `defineDevtoolsRenderTab(...)` spec or a `render(el, props)` function — with the dashboard's event bus. `defineDevtoolsRenderTab` was exported before but nothing rendered it. Modules from other origins are refused.
