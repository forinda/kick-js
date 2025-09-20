import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { KickConfig, KickStructureConfig } from './types';
import { createError } from '../utils/errors';

const CONFIG_FILE_CANDIDATES = [
  'kick.config.ts',
  'kick.config.js',
  'kick.config.mjs',
  'kick.config.cjs',
  'kick.config.json'
];

let tsNodeRegistered = false;

export async function loadKickConfig(cwd = process.cwd()): Promise<KickConfig | undefined> {
  for (const file of CONFIG_FILE_CANDIDATES) {
    const absolute = path.join(cwd, file);
    if (!existsSync(absolute)) {
      continue;
    }

    if (file.endsWith('.json')) {
      const raw = await fs.readFile(absolute, 'utf8');
      return normalizeConfig(JSON.parse(raw));
    }

    if (file.endsWith('.ts')) {
      ensureTsNode();
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(absolute);
    const config = loaded?.default ?? loaded;
    return normalizeConfig(config);
  }

  return undefined;
}

function ensureTsNode() {
  if (tsNodeRegistered) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('ts-node/register');
    tsNodeRegistered = true;
  } catch (error) {
    throw createError('TS_NODE_REQUIRED', 'Custom CLI config requires ts-node for TypeScript configuration files.');
  }
}

function normalizeConfig(raw: unknown): KickConfig {
  if (!raw || typeof raw !== 'object') {
    throw createError('INVALID_CLI_CONFIG', 'kick.config must export an object');
  }

  const config = raw as KickConfig;
  const normalized: KickConfig = {};

  if (Array.isArray(config.commands)) {
    normalized.commands = config.commands.map((command) => {
      if (!command || typeof command !== 'object') {
        throw createError('INVALID_CLI_COMMAND', 'Command entries must be objects');
      }
      if (!command.name) {
        throw createError('INVALID_CLI_COMMAND', 'Command entries must include a name');
      }

      return {
        name: command.name,
        description: command.description,
        steps: Array.isArray(command.steps)
          ? [...command.steps]
          : command.steps
          ? [command.steps]
          : []
      };
    });
  }

  if (config.generators) {
    normalized.generators = {
      controllerRoot: config.generators.controllerRoot ?? undefined
    };
  }

  if (config.structure) {
    normalized.structure = normalizeStructureConfig(config.structure);
  }

  return normalized;
}

export type { KickConfig } from './types';

function normalizeStructureConfig(raw: KickStructureConfig): KickStructureConfig {
  return {
    domainRoot: raw.domainRoot ?? 'src/domains',
    domainFolders: Array.isArray(raw.domainFolders) && raw.domainFolders.length > 0 ? [...raw.domainFolders] : ['controllers', 'services', 'domain'],
    defaultDomain: raw.defaultDomain ?? 'app'
  };
}
