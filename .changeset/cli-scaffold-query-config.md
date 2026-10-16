---
'@forinda/kickjs-cli': patch
---

`kick g scaffold` builds `<name>.constants.ts` from the fields instead of a hard-coded `name`: string fields are filterable, sortable and searchable, other scalars filterable and sortable, `json` neither, and `createdAt` is always sortable. `kick g scaffold invoice amount:number` now passes `?sort=-amount` through to the repository (`parsed.sort`) instead of dropping it.
