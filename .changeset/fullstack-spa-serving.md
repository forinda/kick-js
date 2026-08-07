---
'@forinda/kickjs-cli': minor
---

Fullstack template: serve the built frontend from the API origin

`kick new --template fullstack` scaffolds `server/` + `web/` and wires a typed
dev loop — Vite serves the client and proxies `/api` to the server. But it
stopped at the deploy boundary: `pnpm build` produced `web/dist` and **nothing
ever served it**. The generated bootstrap had no adapters, and the root had no
`start` script — only `vite preview`, which is a dev preview server.

The generated server now wires `SpaAdapter({ clientDir: '../web/dist' })`, and
the root gains a `start` script that runs the server. So:

|            | dev                       | production               |
| ---------- | ------------------------- | ------------------------ |
| `web/dist` | absent                    | present                  |
| SpaAdapter | inert (registers nothing) | serves `/`               |
| `/api/v1`  | Vite proxy → `:3000`      | controllers, same origin |

Dev is unchanged: the adapter early-returns while the build directory does not
exist, which is the normal state under `kick dev`.

`generateEntryFile` takes an optional `spaClientDir` and composes it with the
existing swagger / devtools adapter injection rather than replacing it.
