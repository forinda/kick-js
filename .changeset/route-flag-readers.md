---
'@forinda/kickjs': minor
'@forinda/kickjs-swagger': minor
'@forinda/kickjs-devtools': minor
---

Route flags reach the OpenAPI spec and the DevTools dashboard (phase 4 of `route-flags-design.md`).

**`getRouteFlags(controllerClass, handlerName)`** resolves a route's flags from the controller — the same method-over-class result `ctx.route.flags` carries at request time, for consumers that see a controller and a method name rather than a live request: an adapter's `onRouteMount`, spec generation, tooling.

**Swagger gains `publicFlag`.** Name the flag your project uses for public endpoints and the spec reads the same declaration the runtime does, instead of asking for a second annotation that can drift from it:

```ts
export const Public = defineRouteFlag('auth.public')

SwaggerAdapter({ bearerAuth: true, publicFlag: 'auth.public' })
```

The name is configuration rather than a constant, because the framework deliberately names no flags — one project's `auth.public` is another's `public` or `security.none`. A list accepts several. It sits after `@ApiPublic` and `securityResolver` in the resolution order and before the `@ApiSecurity` / `@ApiBearerAuth` decorators, so an explicit resolver still wins while a flag still overrides class-level security.

**DevTools reports flags per route.** `GET /_debug/routes` includes a `flags` object on each entry, and the dashboard's Routes tab shows them in a Flags column — so "why does this endpoint not require auth" is answerable from the route list rather than by reading the controller. Only flags in force appear: one turned off at the method is absent, not `false`.
