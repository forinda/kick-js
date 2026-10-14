---
'@forinda/kickjs-vite': patch
---

Editing a page or component served by the `kick dev` server now hot-updates it in the browser. The plugin marked every changed source file as handled, which cancelled Vite's own browser update, so component edits only showed after a manual refresh.
