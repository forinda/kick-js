---
'@forinda/kickjs': minor
---

Settings sections gain `provide(value)` and `parse(value)`. `bootstrap({ settings: [DbSettings.provide({ url })] })` declares a section with a supplied value instead of reading env — validated the same way, and it wins over the same section declared by a module or adapter. Useful for values known only at run time, like a test container's URL.
