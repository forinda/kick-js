---
'@forinda/kickjs-view': minor
---

New, experimental: `.kick` views — KickJS's own template language for server-rendered pages:

- `{{ value | pipe }}` interpolation, escaped for where it lands: text, attributes, URL attributes (unsafe schemes become `#`) and JSON scripts.
- `@if` / `@else`, `@for` / `@empty`, `@switch`, `@let`, `@verbatim`.
- Bindings: `[attr]`, `[class.x]`, `[style.x]`.
- Layouts with named slots, layouts mapped by folder (one per dashboard), and a `baseLayout` around every page.
- Components with declared `@input`s and slots.
- Built-in pipes (dates, numbers and currency in a given locale and time zone, `json`, `url`, `raw`), plus your own from `src/views/pipes.ts`.
- `createViews().render()` outside a request, for emails and tests.
- `KickView` makes `ctx.render()` work on Express, Fastify, h3 and the web entry; `viewsMiddleware` does the same for the edge.

`kick fmt:views` and `kick check:views` (through `viewCliPlugin` from `@forinda/kickjs-view/cli`) format and check templates.

Templates can't call functions or reach prototypes, and refuse interpolation where escaping can't make it safe. The format is experimental while the package is 0.x.
