---
'@forinda/kickjs-view-language-server': minor
---

TypeScript and JavaScript files: in `ctx.render('…')` and `views.render('…')`, the server completes template names (components left out), goes to the template, and warns "template 'x' not found" for a literal name with no template. It doesn't format, highlight or otherwise touch the rest of the file. Editors attach it to TS and JS files as well as `.kick` to use it.
