---
'@forinda/kickjs-cli': minor
---

typegen: only build the client route map for projects that use it

Producing `.kickjs/types/kick__client.d.ts` builds a whole TypeScript program
over the server. On a 1,940-route API that is the entire cost of `kick typegen`:

|            | with the map | without    |
| ---------- | ------------ | ---------- |
| wall clock | 7.50s        | **0.59s**  |
| peak RSS   | 1127 MB      | **182 MB** |

Every other typegen plugin combined accounts for ~130ms of that. An API with no
frontend was paying twelve seconds and a gigabyte for a file nothing reads.

`typegen.client` now decides:

```ts
export default defineConfig({
  typegen: { client: true },
})
```

Off unless set — the config is the switch, not a file on disk. `kick new
--template fullstack` writes `client: true`, because its web app reads the map.

An existing map does not silently turn it back on; that would leave a project
paying seconds and a gigabyte per typegen with nothing in its config to explain
why. It does warn, naming the setting to add, because a map left unrefreshed is
how a frontend ends up type-checking against routes the server no longer
serves. Existing adopters therefore need one line of config to keep the map
current.
