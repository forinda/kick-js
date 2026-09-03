---
'@forinda/kickjs-cli': patch
---

`kick add` installs the engine peers your project actually uses.

The catalog listed `express` as a static peer of `@forinda/kickjs`, so `kick add kickjs` pulled Express into a Fastify or h3 project. The HTTP engine is chosen at `bootstrap({ runtime })` — which engine package a project needs is a runtime question, not a fixed dependency.

It now resolves from the project's runtime (the `runtime` field in `kick.config.ts`, else the engine already in `package.json`), matching what `kick new` scaffolds for the same engine:

| Runtime   | Installed with `@forinda/kickjs`             |
| --------- | -------------------------------------------- |
| `express` | `express`                                    |
| `fastify` | `fastify`, `@fastify/middie`, `serve-static` |
| `h3`      | `h3`, `serve-static`                         |

`kick add --list` names the resolved engine on the row, and the install prints a notice saying which peers it added and why. `kick add upload` already worked this way; this brings the framework package itself in line.

Also: `kick typegen --list` now prints the file each plugin owns and a copy-pasteable `typegen: { disable: [...] }` snippet, since "which plugin writes this file" is the question you have when deciding to turn one off.
