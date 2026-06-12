---
'@forinda/kickjs-cli': minor
---

`kick typegen` per-file extraction is now AST-based (oxc-parser) with the regex extractors kept as a fallback for unparseable mid-edit sources. Accuracy fixes over the regex path: template-literal route paths extract correctly, `@ApiQueryParams` stacked above the HTTP decorator is no longer silently dropped, string literals containing parens/braces can't skew extraction, aliased named imports resolve as schema sources, and const-bound `createToken` declarations are no longer double-emitted. The scan cache version is bumped so stale regex-era entries refresh on first run.
