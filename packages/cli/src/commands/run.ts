import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Command } from 'commander'
import { runShellCommand } from '../utils/shell'
import { loadKickConfig } from '../config'

export function registerRunCommands(program: Command): void {
  program
    .command('dev')
    .description('Start development server with Vite HMR (zero-downtime reload)')
    .option('-e, --entry <file>', 'Entry file', 'src/index.ts')
    .option('-p, --port <port>', 'Port number')
    .action((opts: any) => {
      const envVars: string[] = []
      if (opts.port) envVars.push(`PORT=${opts.port}`)

      // vite-node --watch gives true HMR via import.meta.hot.accept()
      // The Application.rebuild() swaps the Express handler on the existing
      // http.Server — DB, Redis, Socket.IO connections survive across reloads
      const cmd = `npx vite-node --watch ${opts.entry}`
      const fullCmd = envVars.length ? `${envVars.join(' ')} ${cmd}` : cmd

      console.log(`\n  KickJS dev server starting...`)
      console.log(`  Entry:  ${opts.entry}`)
      console.log(`  HMR:    enabled (vite-node)\n`)

      try {
        runShellCommand(fullCmd)
      } catch {
        // Process exits on SIGINT — expected
      }
    })

  program
    .command('build')
    .description('Build for production via Vite')
    .action(async () => {
      console.log('\n  Building for production...\n')
      runShellCommand('npx vite build')

      // Copy static directories to dist (e.g., templates, public assets)
      const config = await loadKickConfig(process.cwd())
      const copyDirs = config?.copyDirs ?? []

      if (copyDirs.length > 0) {
        console.log('\n  Copying directories to dist...')
        for (const entry of copyDirs) {
          const src = typeof entry === 'string' ? entry : entry.src
          const dest =
            typeof entry === 'string' ? join('dist', entry) : (entry.dest ?? join('dist', src))
          const srcPath = resolve(src)
          const destPath = resolve(dest)

          if (!existsSync(srcPath)) {
            console.log(`    ⚠ Skipped ${src} (not found)`)
            continue
          }

          mkdirSync(destPath, { recursive: true })
          cpSync(srcPath, destPath, { recursive: true })
          console.log(`    ✓ ${src} → ${dest}`)
        }
      }

      console.log('\n  Build complete.\n')
    })

  program
    .command('start')
    .description('Start production server')
    .option('-e, --entry <file>', 'Entry file', 'dist/index.js')
    .option('-p, --port <port>', 'Port number')
    .action((opts: any) => {
      const envVars: string[] = ['NODE_ENV=production']
      if (opts.port) envVars.push(`PORT=${opts.port}`)
      runShellCommand(`${envVars.join(' ')} node ${opts.entry}`)
    })

  program
    .command('dev:debug')
    .description('Start dev server with Node.js inspector')
    .option('-e, --entry <file>', 'Entry file', 'src/index.ts')
    .option('-p, --port <port>', 'Port number')
    .action((opts: any) => {
      const envVars = opts.port ? `PORT=${opts.port} ` : ''
      try {
        runShellCommand(`${envVars}npx vite-node --inspect --watch ${opts.entry}`)
      } catch {
        // SIGINT
      }
    })
}
