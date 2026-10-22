---
'@forinda/kickjs-view-language-server': minor
---

Semantic tokens: the server highlights the template syntax itself, so editors without the VS Code TextMate grammar colour it too. That covers `@if` and the other keywords, `{{ }}` and `|`, names and properties, pipes, component tags, `@input` names, literals and `{{-- --}}` comments, using standard token types so themes colour them. Neovim and JetBrains IDEs (LSP4IJ) show them by default; Zed needs `"semantic_tokens": "combined"` for the Kick language.
