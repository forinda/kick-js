import type { Command } from 'commander'
import { runShellCommand } from '../utils/shell'

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
    .action(() => {
      console.log('\n  Building for production...\n')
      runShellCommand('npx vite build')
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
