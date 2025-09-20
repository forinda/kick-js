import type { Command } from 'commander';
import { KickConfig } from '../config';
import { runShellCommand } from '../utils/shell';

export function registerCustomCommands(program: Command, config?: KickConfig) {
  if (!config?.commands) {
    return;
  }

  config.commands.forEach((command) => {
    const cmd = program
      .command(command.name)
      .description(command.description ?? 'Custom command defined in kick.config');

    cmd.action(async () => {
      if (!command.steps || command.steps.length === 0) {
        console.warn(`No steps defined for command "${command.name}".`);
        return;
      }

      for (const step of command.steps) {
        await runShellCommand(step);
      }
    });
  });
}
