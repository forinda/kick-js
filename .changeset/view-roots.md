---
'@forinda/kickjs-view': minor
'@forinda/kickjs-vite': minor
'@forinda/kickjs-cli': minor
'@forinda/kickjs-view-language-server': minor
---

Named view roots: `.kick` templates can live in more folders than `src/views` — a module's own views folder, or a package that ships views — addressed as `root::path` (`ctx.render('billing::invoices/show')`). Declare them once in `kick.config.ts` under `views: { dir, roots }`; the runtime, the Vite build and dev server, `kick check:views`, `kick fmt:views`, typegen and the language server all read it. A root's references resolve in that root first, then the app's; its component tags start with the root's name (`<ui-button>`). A package says where its views are with `"kick": { "views": "<folder>" }` in its package.json.
