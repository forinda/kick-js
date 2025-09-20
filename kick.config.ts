import type { KickConfig } from './src';

const config: KickConfig = {
  structure: {
    domainRoot: 'src/domains',
    domainFolders: ['controllers', 'services', 'domain'],
    defaultDomain: 'app'
  },
  generators: {
    controllerRoot: 'src/domains/app/controllers'
  },
  commands: [
    { name: 'dev', description: 'Start the Kick dev server', steps: 'npm run dev' },
    { name: 'build', description: 'Bundle library output', steps: 'npm run build' },
    { name: 'test', description: 'Run Vitest suites', steps: 'npm test' }
  ]
};

export default config;
