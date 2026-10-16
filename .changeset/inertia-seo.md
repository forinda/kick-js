---
'@forinda/kickjs-inertia': minor
'@forinda/kickjs-cli': patch
---

SEO for Inertia apps.

- `inertia(component, props, { meta })` sets a page's title, description, canonical URL, robots, Open Graph / Twitter tags and JSON-LD. It is rendered, escaped, into the first-visit `<head>` and sent as the page's `meta` on every visit; a tag a server-rendered `<Head>` sets wins over the same one from `meta`.
- `InertiaAdapter({ meta, baseUrl })`: meta defaults with a `titleTemplate`, and the site URL that canonical and image URLs are made absolute with — never the request's Host header. Error pages are sent `noindex`.
- `sitemap(entries)` and `robots(options)` answer `/sitemap.xml` and `/robots.txt` from a controller, on every runtime.
- `kick new --template inertia`: an `APP_URL` env entry (localhost default only under `NODE_ENV` development or test), a `Seo` component that keeps the browser's `<head>` in sync on client-side visits, meta on the pages, and `/sitemap.xml` + `/robots.txt` routes in `src/modules/seo` (replacing `public/robots.txt`).
