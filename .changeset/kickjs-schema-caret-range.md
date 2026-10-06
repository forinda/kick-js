---
'@forinda/kickjs': patch
'@forinda/kickjs-ai': patch
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-swagger': patch
'@forinda/kickjs-devtools': patch
---

Depend on `@forinda/kickjs-schema` by a caret range (`^0.2.x`) instead of an exact version, so these packages share one copy of it rather than installing several when their releases pin different patch versions.
