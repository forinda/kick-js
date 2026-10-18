---
'@forinda/kickjs-inertia': minor
---

SEO additions:

- **`h()` and `meta.head`:** any other `<meta>` or `<link>` for a page, such as hreflang alternates, `theme-color` or preloads. A tag is keyed by what it sets, so a page's tag replaces the default with the same key.
- **`meta.lang`:** sets `<html lang>`. The default is still `'en'`.
- **Fixes:**
  - The default canonical drops a trailing slash, so `/posts/` and `/posts` share one canonical URL.
  - The title and meta tags now come before the asset tags in `<head>`.
  - Content-hashed build files are sent with `Cache-Control: public, max-age=31536000, immutable`.
