---
'@forinda/kickjs-cli': patch
---

Inertia template SEO defaults:

- **Every page:** `lang`, a Twitter card and a `theme-color` tag.
- **Home page:** WebSite JSON-LD.
- **Descriptions:** search-length meta descriptions.
- **`APP_URL`:** the pages and SEO controllers now read it through an injected `ConfigService`.
