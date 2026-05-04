---
'@forinda/kickjs-drizzle': minor
---

Bump `drizzle-orm` peer-dep floor from `>=0.30.0` to `>=0.45.2` to
push adopters off the **HIGH-severity SQL injection** in earlier
0.45.x and below ([GHSA advisory][advisory]). Pure peer-range change —
no API change in `@forinda/kickjs-drizzle` itself.

**Adopter action**: bump your `drizzle-orm` to `>=0.45.2`. If you're
already on `>=0.45.2`, nothing to do.

[advisory]: https://github.com/advisories/GHSA-gpj5-g38j-94v9
