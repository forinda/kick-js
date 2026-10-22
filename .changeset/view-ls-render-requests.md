---
'@forinda/kickjs-view-language-server': patch
---

Custom requests `kick/renderDefinition` (`{ text, offset }`) and `kick/renderDiagnostics` (`{ text }`). They give the `ctx.render('…')` template-name features for a TypeScript or JavaScript file's text, for clients that don't send those files to the server.
