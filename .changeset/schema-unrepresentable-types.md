---
'@forinda/kickjs-schema': patch
'@forinda/kickjs-swagger': patch
---

`z.date()` (and `z.coerce.date()`, bigints, Maps, Sets, transforms, custom types) no longer drop a schema from the OpenAPI spec. Zod and Valibot threw on them, and the builder silently left the request body out — or copied the validator's own object into a response. Now dates are documented as `date-time` strings, bigints as integers (`int64` for `z.int64()`, the one held to that range), and the rest as any value. A request schema with a plain `z.date()` / `z.bigint()` (or Valibot's) gets a one-time warning: JSON can't send a `Date` or `bigint`, so it rejects every request — use `z.coerce.date()` / `z.iso.datetime()`; Yup dates get the format too, and Yup types JSON Schema has no name for are untyped instead of invalid.

The spec is also correct OpenAPI 3.0 now: `target` reaches the adapters, so a nullable field is `nullable: true`, not `type: ['string', 'null']`. Requests are described by what they accept and responses by what they return (a field with a default isn't required in a body), recursive schemas point at their own component instead of `#`, and a schema that fails to convert is reported instead of vanishing.
