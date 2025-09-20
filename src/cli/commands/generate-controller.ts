import type { Command } from 'commander';
import { generateController } from '../tasks/generate-controller';
import type { KickStructureConfig } from '../types';
import { generateDomain } from '../tasks/generate-domain';

export function registerGeneratorCommands(
  program: Command,
  defaults: { controllerRoot?: string; structure?: KickStructureConfig } = {}
) {
  const generate = program.command('generate').description('Generate Kick resources');

  generate
    .command('domain <name>')
    .description('Scaffold a domain folder with optional default files')
    .option('-f, --force', 'Overwrite existing generated files', false)
    .option('--no-controller', 'Do not create a default controller')
    .action(async (name: string, options: { force?: boolean; controller?: boolean }) => {
      const result = await generateDomain({
        name,
        structure: defaults.structure,
        force: options.force,
        withController: options.controller
      });

      console.log(`Domain root: ${result.root}`);
      if (result.createdFolders.length > 0) {
        console.log(`Created:\n - ${result.createdFolders.join('\n - ')}`);
      }
      if (result.existingFolders.length > 0) {
        console.log(`Existing:\n - ${result.existingFolders.join('\n - ')}`);
      }
    });

  generate
    .command('controller <name>')
    .description('Generate a file-system discovered controller')
    .option('-m, --method <verb>', 'HTTP verb to use (get, post, put, patch, delete)', 'get')
    .option('-r, --root <path>', 'Root directory for generated controllers', defaults.controllerRoot ?? 'src/http')
    .option('-f, --force', 'Overwrite the controller if it already exists', false)
    .option('--tags <tags>', 'Comma separated tags to assign to the controller')
    .action(async (name: string, options: { method?: string; root?: string; force?: boolean; tags?: string }) => {
      const tags = options.tags
        ? options.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined;

      const defaultRoot = computeDefaultControllerRoot(defaults, name);
      const result = await generateController({
        name,
        method: options.method,
        root: options.root ?? defaultRoot,
        force: options.force,
        tags
      });

      if (result.created) {
        console.log(`Created controller at ${result.filePath}`);
      } else {
        console.log(`Controller already exists at ${result.filePath}`);
      }
    });
}

function computeDefaultControllerRoot(
  defaults: { controllerRoot?: string; structure?: KickStructureConfig },
  name: string
) {
  if (defaults.controllerRoot) {
    return defaults.controllerRoot;
  }

  const structure = defaults.structure;
  if (!structure) {
    return 'src/http';
  }

  const domainRoot = structure.domainRoot ?? 'src/domains';
  const defaultDomain = structure.defaultDomain ?? 'app';

  if (name.includes('/')) {
    const [maybeDomain] = name.split('/');
    return `${domainRoot}/${maybeDomain}/controllers`;
  }

  return `${domainRoot}/${defaultDomain}/controllers`;
}
