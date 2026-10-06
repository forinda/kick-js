---
'@forinda/kickjs-db': patch
---

`findOrCreate`'s `create` must now supply every required column that `where` leaves out. A seed or service that missed one (a column added since) compiled and then failed with `NOT NULL` at run time; it's a type error now.
