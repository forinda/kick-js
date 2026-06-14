---
'@forinda/kickjs-cli': patch
---

Fix `kick new --runtime fastify|h3` installing a `@forinda/kickjs` that lacks the engine subpath. The Fastify / h3 runtimes ship on the `alpha` channel for now, but the scaffolder resolved `@forinda/kickjs` from the `latest` dist-tag — so a generated Fastify/h3 app pinned a stable kickjs without the `./fastify` / `./h3` exports and failed to boot under Vite (`"./h3" is not exported …`). The scaffolder now pins `@forinda/kickjs` to the `alpha` channel (exact prerelease version) when a non-Express runtime is chosen, and warns with a manual `add @forinda/kickjs@alpha` hint if the alpha can't be resolved. Express scaffolds stay on the stable channel.

Also refreshed the generated agent docs (`AGENTS.md` / `CLAUDE.md` / README templates) to describe KickJS as engine-pluggable (Express / Fastify / h3) instead of Express-only, with an explicit "don't assume Express" section, the `runtime` config field, cross-engine uploads, and `kick add upload` / `kick doctor` — so coding agents don't hallucinate an Express-only framework.
