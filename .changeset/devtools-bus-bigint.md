---
'@forinda/kickjs-devtools': patch
---

The DevTools event bus never throws into whoever emits an event. With a dashboard tab open, a kick/db query with a `bigint` parameter (an insert into a `bigint` column) used to fail with `TypeError: Do not know how to serialize a BigInt`, because the bus serialised the event inside the query. Bigints now go to the dashboard as strings, and an event JSON can't hold at all (a circular payload) is dropped for the dashboard instead of failing the caller.
