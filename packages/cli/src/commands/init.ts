import { resolve, basename } from 'node:path'
import { createInterface } from 'node:readline'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import type { Command } from 'commander'
import { initProject } from '../generators/project'

function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const suffix = defaultValue ? ` (${defaultValue})` : ''
  return new Promise((res) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close()
      res(answer.trim() || defaultValue || '')
    })
  })
}

async function choose(question: string, options: string[], defaultIdx = 0): Promise<string> {
  console.log(`  ${question}`)
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? '>' : ' '
    console.log(`   ${marker} ${i + 1}. ${options[i]}`)
  }
  const answer = await ask('Choose', String(defaultIdx + 1))
  const idx = parseInt(answer, 10) - 1
  return options[idx] ?? options[defaultIdx]
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await ask(`${question} (${hint})`)
  if (!answer) return defaultYes
  return answer.toLowerCase().startsWith('y')
}

export function registerInitCommand(program: Command): void {
  program
    .command('new [name]')
    .alias('init')
    .description('Create a new KickJS project (use "." for current directory)')
    .option('-d, --directory <dir>', 'Target directory (defaults to project name)')
    .option('--pm <manager>', 'Package manager: pnpm | npm | yarn')
    .option('--git', 'Initialize git repository')
    .option('--no-git', 'Skip git initialization')
    .option('--install', 'Install dependencies after scaffolding')
    .option('--no-install', 'Skip dependency installation')
    .option('-f, --force', 'Remove existing files without prompting')
    .option(
      '-t, --template <type>',
      'Project template: rest | graphql | ddd | microservice | minimal',
    )
    .action(async (name: string | undefined, opts: any) => {
      console.log()

      // Resolve project name — support "." for current directory
      if (!name) {
        name = await ask('Project name', 'my-api')
      }

      let directory: string
      if (name === '.') {
        directory = resolve('.')
        name = basename(directory)
      } else {
        directory = resolve(opts.directory || name)
      }

      // Check if target directory exists and is non-empty
      if (existsSync(directory)) {
        const entries = readdirSync(directory)
        if (entries.length > 0) {
          if (opts.force) {
            console.log(`  Clearing existing files in ${directory}...\n`)
          } else {
            console.log(`  Directory "${name}" is not empty:`)
            const shown = entries.slice(0, 5)
            for (const entry of shown) {
              console.log(`    - ${entry}`)
            }
            if (entries.length > 5) {
              console.log(`    ... and ${entries.length - 5} more`)
            }
            console.log()
            const shouldClear = await confirm('Remove all existing files and proceed?', false)
            if (!shouldClear) {
              console.log('  Aborted.\n')
              return
            }
          }
          // Remove contents but keep the directory itself
          for (const entry of entries) {
            rmSync(resolve(directory, entry), { recursive: true, force: true })
          }
        }
      }

      // Template — prompt if not provided via --template
      let template = opts.template
      if (!template) {
        template = await choose(
          'Project template:',
          [
            'REST API (Express + Swagger)',
            'GraphQL API (GraphQL + GraphiQL)',
            'DDD (Domain-Driven Design modules)',
            'Microservice (REST + Queue worker)',
            'Minimal (bare Express)',
          ],
          0,
        )
        // Map display names to config values
        const templateMap: Record<string, string> = {
          'REST API (Express + Swagger)': 'rest',
          'GraphQL API (GraphQL + GraphiQL)': 'graphql',
          'DDD (Domain-Driven Design modules)': 'ddd',
          'Microservice (REST + Queue worker)': 'microservice',
          'Minimal (bare Express)': 'minimal',
        }
        template = templateMap[template] ?? 'rest'
      }

      // Package manager — prompt if not provided via --pm
      let packageManager = opts.pm
      if (!packageManager) {
        packageManager = await choose('Package manager:', ['pnpm', 'npm', 'yarn'], 0)
      }

      // Git init — prompt if not explicitly set
      let initGit: boolean
      if (opts.git === undefined) {
        initGit = await confirm('Initialize git repository?', true)
      } else {
        initGit = opts.git
      }

      // Install deps — prompt if not explicitly set
      let installDeps: boolean
      if (opts.install === undefined) {
        installDeps = await confirm('Install dependencies?', true)
      } else {
        installDeps = opts.install
      }

      await initProject({
        name,
        directory,
        packageManager,
        initGit,
        installDeps,
        template,
      })
    })
}
