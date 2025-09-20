import path from 'node:path';
import { ensureDirectory, writeFileSafe, fileExists } from '../utils/fs';
import type { KickStructureConfig } from '../types';

export interface GenerateDomainOptions {
  name: string;
  structure?: KickStructureConfig;
  force?: boolean;
  withController?: boolean;
}

export interface GenerateDomainResult {
  root: string;
  createdFolders: string[];
  existingFolders: string[];
  controllerPath?: string;
  controllerCreated?: boolean;
}

export async function generateDomain(options: GenerateDomainOptions): Promise<GenerateDomainResult> {
  const structure = options.structure ?? {
    domainRoot: 'src/domains',
    domainFolders: ['controllers', 'services', 'domain'],
    defaultDomain: 'app'
  };

  const domainRoot = structure.domainRoot ?? 'src/domains';
  const domainRootBase = path.isAbsolute(domainRoot) ? domainRoot : path.join(process.cwd(), domainRoot);
  const folders = structure.domainFolders && structure.domainFolders.length > 0 ? structure.domainFolders : ['controllers'];
  const targetRoot = path.join(domainRootBase, options.name);

  const createdFolders: string[] = [];
  const existingFolders: string[] = [];

  for (const folder of folders) {
    const folderPath = path.join(targetRoot, folder);
    const alreadyExists = await fileExists(folderPath);
    await ensureDirectory(folderPath);
    if (alreadyExists) {
      existingFolders.push(path.relative(process.cwd(), folderPath));
    } else {
      createdFolders.push(path.relative(process.cwd(), folderPath));
    }
  }

  let controllerPath: string | undefined;
  let controllerCreated: boolean | undefined;

  if (options.withController !== false && folders.includes('controllers')) {
    controllerPath = path.join(targetRoot, 'controllers', 'index.get.controller.ts');
    controllerCreated = await writeFileSafe(
      controllerPath,
      `import type { Request, Response } from 'express';\nimport { GetController } from '@forinda/kickjs';\n\nexport default class ${capitalize(options.name)}IndexGetController extends GetController {\n  handle(_req: Request, res: Response) {\n    return this.ok(res, { domain: '${options.name}', message: 'Hello from ${options.name}' });\n  }\n}\n`,
      { force: options.force }
    );
    if (controllerCreated) {
      createdFolders.push(path.relative(process.cwd(), controllerPath));
    } else if (controllerPath) {
      existingFolders.push(path.relative(process.cwd(), controllerPath));
    }
  }

  return {
    root: targetRoot,
    createdFolders,
    existingFolders,
    controllerPath,
    controllerCreated
  };
}

function capitalize(value: string) {
  if (!value) {
    return 'Domain';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
