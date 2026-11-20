---
'@forinda/kickjs-view': minor
'@forinda/kickjs-vite': minor
'@forinda/kickjs-view-language-server': patch
---

Translations and more built-in pipes for `.kick` views.

- `t` prints a message from `src/views/locales/<locale>.json`: `{{ 'cart.items' | t:'count':n }}`. Plural forms, locale fallback (`sw-KE` → `sw` → the default), and `views.t(key, params, { locale })` for controllers and emails. The build checks literal keys and their placeholders; the Vite plugin bundles the catalogues as `messages`.
- New pipes: `truncate`, `default`, `nl2br`, `striptags`, `first`, `last`, `length`, `sort`, `groupBy`, `sum`, `plural`, `ago`, `filesize`.
- The new pipes and `t` can be replaced: an app pipe of the same name wins, so existing `pipes.ts` files that define `ago` or `truncate` keep working.
