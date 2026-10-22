---
'@forinda/kickjs-view-language-server': minor
---

Find references and rename. References list every use of a component tag (closing tags included), a layout name or a pipe across templates, with the declaration on request. Rename covers a pipe (its uses and its declaration in `pipes.ts`), a component (every tag, then its file) and a layout (every `@layout('…')`, then its file). Renaming a template file or folder in the editor updates the tags and `@layout('…')` strings that point at it.
