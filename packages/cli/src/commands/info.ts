import { platform, release, arch } from 'node:os'
import type { Command } from 'commander'

export function registerInfoCommand(program: Command): void {
  program
    .command('info')
    .description('Print system and framework info')
    .action(() => {
      console.log(`
  KickJS CLI

  System:
    OS:       ${platform()} ${release()} (${arch()})
    Node:     ${process.version}

  Packages:
    @forinda/kickjs          workspace
    @forinda/kickjs-vite     workspace
    @forinda/kickjs-cli      workspace
`)
    })
}
