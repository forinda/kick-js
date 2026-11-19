#!/usr/bin/env node
/**
 * Standalone `kickjs-db` CLI — run the database command tree without
 * installing `@forinda/kickjs-cli`.
 *
 *   npx kickjs-db migrate latest
 *   npx kickjs-db generate add_users
 *
 * Config resolution (later wins, vite-style merge):
 *   1. `kick.config.{ts,js,mjs,json}` → its `db` block, if present.
 *   2. `kickjs-db.config.{ts,js,mjs,json}` → its default export.
 *
 * `.ts` / `.mjs` configs load through jiti; `.json` is read directly.
 *
 * `--config <file>` (or `KICK_DB_CONFIG`) replaces both for that run.
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { Command } from 'commander'

import {
  loadDbConfigFile,
  readConfigModule,
  registerDbCommands,
  resolveKickDbConfig,
  mergeKickDbConfig,
} from '../dist/cli.mjs'

const CONFIG_EXTS = ['ts', 'mts', 'js', 'mjs', 'json']

function findConfig(baseName, cwd) {
  for (const ext of CONFIG_EXTS) {
    const p = path.join(cwd, `${baseName}.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

async function resolveConfig() {
  const cwd = process.cwd()

  const kickConfigFile = findConfig('kick.config', cwd)
  const dbConfigFile = findConfig('kickjs-db.config', cwd)

  let kickDbBlock
  if (kickConfigFile) {
    const cfg = await readConfigModule(kickConfigFile, cwd)
    kickDbBlock = cfg?.db
  }
  let standaloneBlock
  if (dbConfigFile) {
    standaloneBlock = await loadDbConfigFile(dbConfigFile, cwd)
  }

  if (!kickDbBlock && !standaloneBlock) {
    throw new Error(
      'kickjs-db: no config found — add a `kickjs-db.config.ts` (export default ' +
        'defineKickDbConfig({...})) or a `db` block to `kick.config.ts`.',
    )
  }
  // Standalone config layers over the kick.config db block.
  return resolveKickDbConfig(mergeKickDbConfig(kickDbBlock, standaloneBlock))
}

const program = new Command()
program.name('kickjs-db').description('KickJS database CLI (standalone)')

registerDbCommands(program, resolveConfig)

program.showHelpAfterError()
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
