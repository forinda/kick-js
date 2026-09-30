---
'@forinda/kickjs-cli': minor
---

`kick add swagger | devtools | ws | queue` now wires the package as well as installing it, the same way `kick new --packages` does.

- **Entry file:** the adapter is added to `bootstrap({ adapters: [...] })` in `src/index.ts` (or `src/main.ts`, or `--entry <file>`), and its import is merged in. The file is edited in place through the AST, so the rest of it is left untouched. A second run doesn't add a duplicate. When the file has no such call, the snippet is printed to paste instead.
- **`queue`:** `REDIS_HOST` / `REDIS_PORT` are added to `.env` and `.env.example`, with existing values kept. `queue` now means BullMQ, as in `kick new`, and installs `bullmq` and `ioredis`.
- **Dependencies:** wired packages go into `dependencies`, because the entry file imports them. That includes `devtools`, which used to be added as a dev dependency.
- **Flags:**
  - it refuses to edit files with uncommitted changes, unless `--force` is passed;
  - `--no-wire` installs only.

Also, `kick new` caps `dotenv` at `^17`, the range `@forinda/kickjs` peers on. It used to install `dotenv@18` with an unmet-peer warning.

`kick new` also builds `vite.config.ts`, `kick.config.ts`, README, `netlify.toml` / `vercel.json` and the fullstack workspace's root and web files from template layers. The output is the same, except that README's "Packages" section now lists the `@forinda/*` packages the project actually installs (before, it listed Swagger and DevTools for every `rest` app).
