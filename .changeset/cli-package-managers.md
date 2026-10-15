---
'@forinda/kickjs-cli': patch
---

Commands printed and written for npm, yarn and bun projects run as printed.

- `kick new` ends with `npm run dev` (not `npm dev`) and lists the CLI as `npx kick …` / `pnpm exec kick …` / `yarn kick …` / `bunx kick …`. A bare `kick` needs a global install. The README, `CLAUDE.md` and `AGENTS.md` it writes say the same.
- Install hints in `kick doctor`, `kick dev`, `kick typecheck`, `kick tinker`, `kick explain`, `kick build:*` and typegen name the project's package manager instead of `pnpm`.
- `kick typecheck` finds a type-checker installed at the workspace root, where npm, yarn and bun put it.
- `kick build:netlify` / `build:vercel` bundles a package installed at the workspace root instead of leaving it out of the function.
- Yarn 2+ projects get `.yarnrc.yml` with `nodeLinker: node-modules`, and a Dockerfile using `yarn install --immutable` and `yarn workspaces focus --all --production`. Bun before 1.2 gets `bun.lockb` in its Dockerfile.
- The `test` script passes on a new project with no tests yet (`vitest run --passWithNoTests`).
- `kick g agents` and `kick add` read the package manager from the nearest lockfile, not the first kind found up the tree. With nothing to go on, `kick g agents` assumes npm, like `kick add`.
