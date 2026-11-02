---
'@forinda/kickjs-view': minor
'@forinda/kickjs-view-language-server': patch
---

Two built-in pipes: `join:separator?` prints a list as text (`{{ names | join:', ' }}`), and `compact` drops `null`, `undefined`, `false` and empty strings from a list while keeping `0`. An app pipe already named `join` or `compact` now fails `kick check:views` as a clash with a built-in; rename it.
