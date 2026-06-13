---
'@forinda/kickjs-db': patch
---

`customType` codecs are keyed by column name, so two tables declaring a same-named column with _different_ codecs previously had one silently overwrite the other — corrupting encode/decode for one table with no signal. `createDbClient` now warns at startup when a column name maps to two different codec functions, names both tables, and keeps the first deterministically (first-write-wins instead of the old last-write-wins). Sharing one `customType` instance across tables is the common, safe case and stays silent.
