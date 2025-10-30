import { Command } from 'commander';
import pkg from '../../package.json';
import { registerInitCommand } from './commands/init';
import { registerGeneratorCommands } from './commands/generate-controller';
import { registerRunCommands } from './commands/run';
import { loadKickConfig } from './config';
import { registerCustomCommands } from './commands/custom';

async function main() {
  const program = new Command();
  program.name('kick').description('Kick project CLI').version(pkg.version ?? '0.0.0');

  const config = await loadKickConfig(process.cwd());

  registerInitCommand(program, { structure: config?.structure });
  registerGeneratorCommands(program, {
    controllerRoot: config?.generators?.controllerRoot,
    structure: config?.structure
  });
  registerRunCommands(program);
  registerCustomCommands(program, config);

  program.showHelpAfterError();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
