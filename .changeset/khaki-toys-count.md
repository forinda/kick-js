---
'@forinda/kickjs-cli': patch
---

Generated project docs: stop calling the bare module form an error.

The scaffolded guidance listed `bootstrap({ modules: [TodosModule] })` as a red
flag while its own `write-controller-test` snippet used exactly that form — so
the generated docs contradicted themselves, and following either half could
produce `TypeError: entry is not a constructor`.

The snippet now follows the project's own `modules.style`, which is threaded
into the skill generator: a `class` module is passed bare, a `define` module is
invoked. Emitting one form unconditionally called a class without `new` in
class-style projects.

The red flag is corrected too — the bare name is accepted for a `define` module
with no config, and refused for one that takes config, where it would silently
select the defaults.
