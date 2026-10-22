---
'@forinda/kickjs-view-language-server': patch
---

Renaming a page's `.kick` file or folder updates the `ctx.render('…')` and `views.render('…')` calls that name it. The server scans the project's TS and JS files when the rename happens, skipping `node_modules`, build output, dot folders and `.d.ts`, and uses an open editor's text where there is one.
