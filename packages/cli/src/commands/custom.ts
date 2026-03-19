import type { Command } from 'commander'
import type { KickConfig, KickCommandDefinition } from '../config'
import { runShellCommand } from '../utils/shell'

/**
 * Register custom commands defined in kick.config.ts
 *
 * Developers can extend the CLI with project-specific commands like:
 *   kick db:migrate
 *   kick db:generate
 *   kick seed
 *   kick proto:gen
 *
 * @example kick.config.ts
 * ```ts
 * import { defineConfig } from '@kickjs/cli'
 *
 * export default defineConfig({
 *   commands: [
 *     {
 *       name: 'db:generate',
 *       description: 'Generate Drizzle migrations from schema',
 *       steps: 'npx drizzle-kit generate',
 *     },
 *     {
 *       name: 'db:migrate',
 *       description: 'Run database migrations',
 *       steps: 'npx drizzle-kit migrate',
 *     },
 *     {
 *       name: 'db:push',
 *       description: 'Push schema directly (dev only)',
 *       steps: 'npx drizzle-kit push',
 *     },
 *     {
 *       name: 'db:studio',
 *       description: 'Open Drizzle Studio GUI',
 *       steps: 'npx drizzle-kit studio',
 *     },
 *     {
 *       name: 'db:seed',
 *       description: 'Run seed files',
 *       steps: 'npx tsx src/db/seed.ts',
 *     },
 *     {
 *       name: 'proto:gen',
 *       description: 'Generate TypeScript from protobuf definitions',
 *       steps: [
 *         'npx buf generate',
 *         'echo "Protobuf types generated"',
 *       ],
 *     },
 *   ],
 * })
 * ```
 */
export function registerCustomCommands(program: Command, config: KickConfig | null): void {
  if (!config?.commands?.length) return

  for (const cmd of config.commands) {
    registerSingleCommand(program, cmd)
  }
}

function registerSingleCommand(program: Command, def: KickCommandDefinition): void {
  const command = program.command(def.name).description(def.description)

  if (def.aliases) {
    for (const alias of def.aliases) {
      command.alias(alias)
    }
  }

  // Accept arbitrary trailing arguments
  command.allowUnknownOption(true)
  command.argument('[args...]', 'Additional arguments passed to the command')

  command.action((args: string[]) => {
    const extraArgs = args.join(' ')
    const steps = Array.isArray(def.steps) ? def.steps : [def.steps]

    for (const step of steps) {
      // Replace {args} placeholder with CLI arguments
      const finalCmd = extraArgs ? `${step} ${extraArgs}` : step
      console.log(`  $ ${finalCmd}`)
      try {
        runShellCommand(finalCmd)
      } catch (err: any) {
        console.error(`  Command failed: ${def.name}`)
        process.exitCode = 1
        return
      }
    }
  })
}
