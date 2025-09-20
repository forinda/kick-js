import path from 'node:path';
import { fileExists, ensureDirectory, writeFileSafe, writeJsonFile, readJsonFile } from '../utils/fs';
import type { KickStructureConfig } from '../types';

export interface InitProjectOptions {
  targetDirectory: string;
  force?: boolean;
  packageName?: string;
  structure?: KickStructureConfig;
}

export interface InitProjectResult {
  createdFiles: string[];
  skippedFiles: string[];
}

export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const targetDir = path.resolve(process.cwd(), options.targetDirectory || '.');
  const force = options.force ?? false;
  const structure = normalizeStructure(options.structure);
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  await ensureDirectory(targetDir);

  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = (await readJsonFile<Record<string, unknown>>(packageJsonPath)) ?? {};
  if (Object.keys(packageJson).length === 0) {
    const name = options.packageName ??
      (path.basename(targetDir).replace(/[^a-zA-Z0-9-_]/g, '-') || 'kick-app');
    await writeJsonFile(
      packageJsonPath,
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'commonjs',
        scripts: {
          dev: 'tsx watch src/main.ts',
          build: 'tsup',
          start: 'node dist/main.js',
          test: 'vitest'
        },
        dependencies: {
          '@forinda/kickjs': 'latest'
        },
        devDependencies: {
          typescript: '^5.4.0',
          tsx: '^4.7.0',
          tsup: '^8.0.0',
          vitest: '^3.0.0'
        }
      },
      { force: true }
    );
    createdFiles.push('package.json');
  } else {
    skippedFiles.push('package.json');
  }

  const tsconfigPath = path.join(targetDir, 'tsconfig.json');
  const tsconfigExists = await fileExists(tsconfigPath);
  if (!tsconfigExists || force) {
    await writeJsonFile(
      tsconfigPath,
      {
        compilerOptions: {
          target: 'es2021',
          module: 'commonjs',
          moduleResolution: 'node',
          lib: ['es2021'],
          rootDir: 'src',
          outDir: 'dist',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        },
        include: ['src']
      },
      { force: true }
    );
    createdFiles.push('tsconfig.json');
  } else {
    skippedFiles.push('tsconfig.json');
  }

  const mainFilePath = path.join(targetDir, 'src', 'main.ts');
  const mainCreated = await writeFileSafe(
    mainFilePath,
    `import 'reflect-metadata';\nimport { bootstrap, configureApp } from '@forinda/kickjs';\n\nconfigureApp({ prefix: '/api' });\n\nasync function main() {\n  const { shutdown } = await bootstrap({ port: process.env.PORT ?? 3000 });\n  process.on('SIGINT', shutdown);\n  process.on('SIGTERM', shutdown);\n}\n\nmain().catch((error) => {\n  console.error('Failed to bootstrap Kick app', error);\n  process.exitCode = 1;\n});\n`,
    { force }
  );
  mainCreated ? createdFiles.push('src/main.ts') : skippedFiles.push('src/main.ts');

  const domainBase = path.join(targetDir, structure.domainRoot, structure.defaultDomain);
  for (const folder of structure.domainFolders) {
    const folderPath = path.join(domainBase, folder);
    const exists = await fileExists(folderPath);
    await ensureDirectory(folderPath);
    const relativePath = path.relative(targetDir, folderPath);
    if (exists) {
      skippedFiles.push(relativePath);
    } else {
      createdFiles.push(relativePath);
    }
  }

  const controllerFolder = structure.domainFolders.includes('controllers')
    ? 'controllers'
    : structure.domainFolders[0];
  const controllerPath = path.join(domainBase, controllerFolder, 'hello.get.controller.ts');
  const controllerCreated = await writeFileSafe(
    controllerPath,
    `import type { Request, Response } from 'express';\nimport { GetController } from '@forinda/kickjs';\n\nexport default class HelloGetController extends GetController {\n  handle(_req: Request, res: Response) {\n    return this.ok(res, { message: 'Hello from Kick!' });\n  }\n}\n`,
    { force }
  );
  const relativeControllerPath = path.relative(targetDir, controllerPath);
  controllerCreated ? createdFiles.push(relativeControllerPath) : skippedFiles.push(relativeControllerPath);

  const appConfigDir = path.join(targetDir, 'src', 'config');
  await ensureDirectory(appConfigDir);
  const appConfigPath = path.join(appConfigDir, 'kick.config.ts');
  const appConfigCreated = await writeFileSafe(
    appConfigPath,
    buildAppConfigFile(structure),
    { force }
  );
  const relativeAppConfig = path.relative(targetDir, appConfigPath);
  appConfigCreated ? createdFiles.push(relativeAppConfig) : skippedFiles.push(relativeAppConfig);

  const configPath = path.join(targetDir, 'kick.config.ts');
  const configCreated = await writeFileSafe(
    configPath,
    buildConfigFile(structure),
    { force }
  );
  configCreated ? createdFiles.push('kick.config.ts') : skippedFiles.push('kick.config.ts');

  return { createdFiles, skippedFiles };
}

function normalizeStructure(structure?: KickStructureConfig): Required<KickStructureConfig> {
  return {
    domainRoot: structure?.domainRoot ?? 'src/domains',
    domainFolders:
      structure?.domainFolders && structure.domainFolders.length > 0
        ? [...structure.domainFolders]
        : ['controllers', 'services', 'domain'],
    defaultDomain: structure?.defaultDomain ?? 'app'
  };
}

function buildConfigFile(structure: Required<KickStructureConfig>) {
  const controllerRoot = `${structure.domainRoot}/${structure.defaultDomain}/controllers`;
  const structureSnippet = JSON.stringify(structure, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');

  return `import type { KickConfig } from '@forinda/kickjs';\n\nconst config: KickConfig = {\n  structure: ${structureSnippet},\n  generators: {\n    controllerRoot: '${controllerRoot}'\n  },\n  commands: [\n    {\n      name: 'dev',\n      description: 'Run the Kick dev server',\n      steps: 'npm run dev'\n    }\n  ]\n};\n\nexport default config;\n`;
}

function buildAppConfigFile(structure: Required<KickStructureConfig>) {
  const controllerRoot = `${structure.domainRoot}/${structure.defaultDomain}/controllers`;
  const roots = [controllerRoot, 'src/http'].map((root) => `'${root}'`).join(', ');

  return `import { createKickConfig } from '@forinda/kickjs';\n\nexport default createKickConfig({\n  defaults: {\n    prefix: '/api',\n    api: {\n      discovery: {\n        roots: [${roots}]\n      }\n    }\n  },\n  env: {\n    KICK_PREFIX: 'prefix',\n    KICK_HEALTH: 'healthEndpoint',\n    KICK_LOG_LEVEL: { path: 'logging.level' }\n  }\n});\n`;
}
