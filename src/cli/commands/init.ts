import type { Command } from 'commander';
import { initProject } from '../tasks/init-project';
import type { KickStructureConfig } from '../types';

export function registerInitCommand(program: Command, defaults: { structure?: KickStructureConfig } = {}) {
  program
    .command('init [directory]')
    .description('Scaffold a new Kick project in the target directory')
    .option('-f, --force', 'Overwrite existing files when scaffolding', false)
    .option('-n, --name <packageName>', 'Package name to use in package.json')
    .action(async (directory: string | undefined, options: { force?: boolean; name?: string }) => {
      const targetDirectory = directory ?? '.';
      const result = await initProject({
        targetDirectory,
        force: options.force,
        packageName: options.name,
        structure: defaults.structure
      });

      if (result.createdFiles.length > 0) {
        console.log(`Created files:\n - ${result.createdFiles.join('\n - ')}`);
      }
      if (result.skippedFiles.length > 0) {
        console.log(`Skipped existing files:\n - ${result.skippedFiles.join('\n - ')}`);
      }

      console.log('Project scaffold complete. Run "npm install" to install dependencies.');
    });
}
