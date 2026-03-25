# Migrating kick dev from vite-node to Vite Module Runner (KICK-034)

## Current State

`kick dev` runs:
```bash
npx vite-node --watch src/index.ts
```

This uses `vite-node` (now deprecated, v6 is maintained) to:
1. Start a Vite dev server internally
2. Transform `src/index.ts` through Vite's plugin pipeline (SWC for decorators)
3. Execute the transformed code in Node.js
4. Watch for changes and re-execute with HMR via `import.meta.hot`

## Replacement: Vite Environment Module Runner

Available in Vite 6+ (stable in Vite 8+). Two approaches:

### Approach A: RunnableDevEnvironment (simpler, recommended)

Use Vite's built-in `RunnableDevEnvironment` which bundles everything:

```ts
import { createServer, isRunnableDevEnvironment } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  environments: {
    server: {
      // runs modules in the same process as the Vite server
    },
  },
})

const env = server.environments.server

if (isRunnableDevEnvironment(env)) {
  // This replaces: npx vite-node --watch src/index.ts
  await env.runner.import('/src/index.ts')
}
```

HMR works automatically when the entry file has:
```ts
if (import.meta.hot) {
  import.meta.hot.accept()
}
```

**This is exactly what our bootstrap already does** — `packages/http/src/bootstrap.ts` already has `import.meta.hot.accept()`.

### Approach B: ModuleRunner (lower-level, more control)

For custom runtimes or separate processes:

```ts
import { ModuleRunner, ESModulesEvaluator, createNodeImportMeta } from 'vite/module-runner'

const runner = new ModuleRunner(
  {
    transport,  // RPC between runner and Vite server
    createImportMeta: createNodeImportMeta,
    hmr: true,
  },
  new ESModulesEvaluator(),
)

await runner.import('/src/index.ts')
```

## What Would Change in KickJS

### File: `packages/cli/src/commands/run.ts`

Current:
```ts
const cmd = `npx vite-node --watch ${opts.entry}`
runShellCommand(cmd)
```

Proposed:
```ts
import { createServer, isRunnableDevEnvironment } from 'vite'

const server = await createServer({
  configFile: resolve('vite.config.ts'),
  environments: {
    server: {},
  },
})

const env = server.environments.server
if (isRunnableDevEnvironment(env)) {
  await env.runner.import(`/${opts.entry}`)
}
```

### Benefits
- No separate `vite-node` dependency
- Uses the same Vite server for transforms and HMR
- Better source map support (automatic, no manual `ssrFixStacktrace`)
- Future-proof — Vite team actively developing this

### Risks
- Requires Vite 6+ (we're on 7.3.1 — fine)
- `RunnableDevEnvironment` API may still evolve
- Need to test decorator support (SWC plugin) works through the runner
- `kick dev:debug` with `--inspect` needs different approach (can't just add a flag to a shell command)

### Dependencies Removed
- `vite-node` from devDependencies in all examples
- `vite-node` from project template (`project-config.ts`)

### Dependencies Kept
- `vite` (already a dependency)
- `unplugin-swc` (still needed for decorator transforms)

## Migration Checklist

- [ ] Update `packages/cli/src/commands/run.ts` to use `createServer` + `RunnableDevEnvironment`
- [ ] Handle `kick dev:debug` — use Node.js `--inspect` with programmatic server
- [ ] Test decorator transforms work through the runner (SWC plugin)
- [ ] Test HMR rebuild (Application.rebuild) works correctly
- [ ] Remove `vite-node` from `project-config.ts` template
- [ ] Remove `vite-node` from all 10 example `package.json` files
- [ ] Update `CLAUDE.md` and `AGENTS.md` references
- [ ] Update docs that reference `vite-node`
- [ ] Run full test suite on all examples

## Decision

**Not blocking the v1.3.x release.** `vite-node` v6 works fine and is maintained. The migration to Vite Module Runner is a KICK-034 future item — it's a dev tooling change, not a runtime change, so it doesn't affect published packages.
