import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { initProject } from '../src/cli/tasks/init-project';
import { generateController } from '../src/cli/tasks/generate-controller';
import { generateDomain } from '../src/cli/tasks/generate-domain';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kick-cli-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('CLI tooling', () => {
  it('scaffolds a project structure with initProject', async () => {
    const result = await initProject({ targetDirectory: tempDir, force: true, packageName: 'kick-test' });
    expect(result.createdFiles).toContain('package.json');

    const mainFile = await fs.readFile(path.join(tempDir, 'src', 'index.ts'), 'utf8');
    expect(mainFile).toContain('createKickAppWithConfig');

    const controllerFile = await fs.readFile(
      path.join(tempDir, 'src', 'controllers', 'user.controller.ts'),
      'utf8'
    );
    expect(controllerFile).toContain('UserController');

    const appConfigFile = await fs.readFile(path.join(tempDir, 'kick.config.js'), 'utf8');
    expect(appConfigFile).toContain('module.exports');
  });

  it('generates controllers following the naming convention', async () => {
    const root = path.join(tempDir, 'api/http');
    const result = await generateController({ name: 'admin/reports/[id]', method: 'get', root });
    expect(result.created).toBe(true);
    const fileContent = await fs.readFile(result.filePath, 'utf8');
    expect(fileContent).toContain('AdminReportsIdGetController');
    expect(fileContent).toContain("import { GetController }");
  });

  it('scaffolds a domain structure with generateDomain', async () => {
    const structure = {
      domainRoot: path.join(tempDir, 'domains'),
      domainFolders: ['controllers', 'services'],
      defaultDomain: 'app'
    } as const;

    const { createdFolders, controllerCreated } = await generateDomain({
      name: 'sales',
      structure,
      force: true
    });

    expect(createdFolders.some((entry) => entry.includes('sales/controllers'))).toBe(true);
    expect(controllerCreated).toBe(true);
  });
});
