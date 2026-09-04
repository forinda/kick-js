---
'@forinda/kickjs-db': patch
---

Fix two ways `kick db introspect` changed a column's meaning.

**A column defaulting off a standalone sequence was rendered `serial()` (#649).**
Detection keyed on the `nextval(...)` default alone, so an ordinary integer
whose default came from a separately declared sequence was reported as a serial.
That dropped the sequence link (a serial's default is collapsed to null) and,
for a nullable column, silently made it NOT NULL. A column is now a serial only
if it OWNS the sequence its default actually draws from, and is NOT NULL — a serial
whose NOT NULL has been dropped comes back as a plain integer keeping its
default, since re-imposing the constraint would reject the rows that caused it
to be dropped.

**Array columns lost their element type (#648).** Two causes: introspect
reported PG's internal element name (`int4[]`, `bool[]`, `bpchar[]`) rather than
the DSL's, and the renderer had no array branch at all, so every array fell
through to `text(/* TODO */)`. Element names are now mapped to the DSL surface
and arrays render as the element helper plus `.array()`. An unmapped element
type still keeps its array-ness.
