---
'@forinda/kickjs-cli': patch
---

Generated project docs: stop calling the bare module form an error.

The scaffolded guidance listed `bootstrap({ modules: [TodosModule] })` as a red
flag while its own `write-controller-test` snippet used exactly that form — so
the generated docs contradicted themselves, and following either half could
produce `TypeError: entry is not a constructor`.

`@forinda/kickjs` now accepts both forms, so the red flag is a consistency note
rather than an error, and the snippet uses the invoked form to match
`modules.style: 'define'`.
