import type { Command } from 'commander'
import { resolve } from 'node:path'

/**
 * Register the `kick typegen` command.
 *
 * Generates `.kickjs/types/container.d.ts` with a typed ContainerTokenMap
 * from scanning @Service/@Controller/@Repository decorators in the source.
 */
export function registerTypegenCommand(program: Command): void {
  program
    .command('typegen')
    .description('Generate typed ContainerTokenMap from decorated classes')
    .option('-s, --src <dir>', 'Source directory to scan', 'src')
    .option('-w, --watch', 'Watch for changes and regenerate')
    .action(async (opts: { src: string; watch?: boolean }) => {
      const rootDir = resolve('.')

      try {
        const { generateContainerTypes } = await import('@forinda/kickjs-vite')
        const outFile = generateContainerTypes(rootDir, opts.src)
        console.log(`Generated: ${outFile}`)

        if (opts.watch) {
          const { watch } = await import('node:fs')
          const srcDir = resolve(rootDir, opts.src)
          console.log(`Watching ${srcDir} for changes...`)

          let debounce: ReturnType<typeof setTimeout> | null = null
          watch(srcDir, { recursive: true }, (_event, filename) => {
            if (!filename?.endsWith('.ts') || filename.endsWith('.d.ts')) return
            if (debounce) clearTimeout(debounce)
            debounce = setTimeout(() => {
              const out = generateContainerTypes(rootDir, opts.src)
              console.log(`Regenerated: ${out}`)
            }, 200)
          })
        }
      } catch (err: any) {
        if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND') {
          console.error(
            'Error: @forinda/kickjs-vite is required for typegen.\n' +
              'Install it: pnpm add -D @forinda/kickjs-vite',
          )
          process.exit(1)
        }
        throw err
      }
    })
}
