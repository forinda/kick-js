import type { Command } from 'commander';
import { initProject } from '../tasks/init-project';
import type { KickStructureConfig } from '../types';

export function registerInitCommand(program: Command, defaults: { structure?: KickStructureConfig } = {}) {
  program
    .command('init [directory]')
    .description('Scaffold a new KickJS project with complete setup')
    .option('-f, --force', 'Overwrite existing files when scaffolding', false)
    .option('-n, --name <packageName>', 'Package name to use in package.json')
    .action(async (directory: string | undefined, options: { force?: boolean; name?: string }) => {
      const targetDirectory = directory ?? '.';
      
      console.log('🚀 Initializing KickJS project...');
      console.log(`📁 Target directory: ${targetDirectory}`);
      
      const result = await initProject({
        targetDirectory,
        force: options.force,
        packageName: options.name,
        structure: defaults.structure
      });

      if (result.createdFiles.length > 0) {
        console.log('\n✅ Created files:');
        result.createdFiles.forEach(file => console.log(`   ✓ ${file}`));
      }
      
      if (result.skippedFiles.length > 0) {
        console.log('\n⚠️  Skipped existing files:');
        result.skippedFiles.forEach(file => console.log(`   - ${file}`));
      }

      console.log('\n🎉 Project scaffold complete!');
      console.log('\n📦 Next steps:');
      console.log('   1. Install dependencies:');
      console.log('      npm install');
      console.log('\n   2. Start development server:');
      console.log('      npm run dev');
      console.log('\n   3. Build for production:');
      console.log('      npm run build');
      console.log('\n   4. Run production server:');
      console.log('      npm start');
      console.log('\n   5. Type check your code:');
      console.log('      npm run typecheck');
      console.log('\n📚 Learn more at: https://github.com/forinda/kick-js');
    });
}
