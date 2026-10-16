---
'@forinda/kickjs-di': minor
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': patch
---

`container.registerFallback(token, factory, scope?)` — a default binding used only while nothing else binds the token, whatever the registration order. An adapter can register one in `beforeMount` (before modules register) and a module's `register()` binding still wins. `has(token)` stays `false` for a fallback-only token, and `getRegistrations()` marks a token its fallback serves with `fallback: true`; DevTools shows a _fallback_ badge on it. Binding the token normally after its singleton fallback was resolved throws the new `KICK010`, since code already holding the fallback would disagree with the new binding.
