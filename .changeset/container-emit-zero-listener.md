---
'@forinda/kickjs': patch
---

perf(container): skip change-event bookkeeping when no listener is attached

`Container.resolve()` emitted a debounced change event on every call — including
the hot cached-singleton path. With no `onChange` subscriber (the production
default; only DevTools or tests subscribe), each resolve still scanned the
pending batch, pushed an entry, and rescheduled a `setTimeout`, only for the
flush to iterate an empty listener set and discard the work. `emit()` now
short-circuits when there are zero listeners, keeping `resolve()` allocation- and
timer-free on the common path. Behaviour is unchanged when a listener is present;
registration counters (`resolveCount`, `lastResolvedAt`) are updated regardless.
