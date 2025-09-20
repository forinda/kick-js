import { readFileSync } from 'node:fs';
import path from 'node:path';

type EnvStore = Record<string, string>;

function parseEnv(content: string): EnvStore {
  const result: EnvStore = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) {
      continue;
    }

    const match = line.match(/^(\w[\w\d_\.]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }

  return result;
}

export function loadEnvFiles(files: string[]) {
  for (const file of files) {
    if (!file) {
      continue;
    }
    const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);

    try {
      const content = readFileSync(filePath, 'utf8');
      const parsed = parseEnv(content);
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      // ignore missing files
    }
  }
}
