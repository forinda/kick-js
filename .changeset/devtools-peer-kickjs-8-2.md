---
'@forinda/kickjs-devtools': patch
---

Raise the `@forinda/kickjs` peer range from `>=5.18.0` to `>=8.2.0`.

The adapter imports `getRouteFlags`, which `@forinda/kickjs` first exported in 8.2.0. On 5.18–8.1 the peer range was satisfied but the app failed at startup on the missing export. The range now says what the package actually needs, so the package manager warns at install time instead.
