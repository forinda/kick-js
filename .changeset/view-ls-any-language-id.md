---
'@forinda/kickjs-view-language-server': patch
---

Any file ending in `.kick` is treated as a template, whatever `languageId` the editor sends. Before, a client that sent `html` or `plaintext` got no diagnostics, completion or formatting at all, which is what most editors do unless you configure a language ID. New guide: setting up `kick-view-ls --stdio` in Neovim, Vim, Helix, Emacs and JetBrains IDEs.
