---
'@forinda/kickjs-view-language-server': minor
---

`layout` and `baseLayout` initialization options, the same as `createViews({ layout, baseLayout })`. Pages that declare no `@layout` are checked against the mapped layout and the base layout, as the build does, so their `@slot` blocks no longer warn "has no layout to fill here". Slot completion offers those layouts' slots, and editing a configured layout re-checks every page.
