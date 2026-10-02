---
'@forinda/kickjs-db': minor
---

`kick db generate` asks which drops are renames. When a table or column is dropped and a new one could replace it, a terminal run asks "Column people.fullName is gone. Was it renamed?". Tables are asked about first, then columns, including those inside a renamed table. A rename that also changes the type is a rename plus an alter, so rows keep their values.

Outside a terminal, name renames with `--rename-table old=new` / `--rename-column table.old=new`. Any other drop that could be a rename prints a warning with the flag that would keep it.

Programmatically, `generate({ renames, askRenames, onPossibleRename })` and `diff(prev, next, { renames })` do the same, and `findRenameCandidates()` lists the possible renames.

Also fixed: a SQLite table rebuild in the same migration as a table or column rename copied from the wrong names and failed.
