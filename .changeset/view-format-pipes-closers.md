---
'@forinda/kickjs-view': patch
---

Formatter: `{{ title|titlecase }}` becomes `{{ title | titlecase }}`, in interpolations and block headers (`@for (x of obj | entries)`); `||` and quoted text are left alone. A closing tag or `}` that follows content on a line, while its opener is on an earlier line, moves to its own line, so `<title>t</title></slot>` no longer leaves `</slot>` trailing. `kick fmt:views` and Format Document in the editor both use it.
