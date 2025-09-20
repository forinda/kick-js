import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function ensureDirectory(target: string) {
  await fs.mkdir(target, { recursive: true });
}

export async function writeFileSafe(filePath: string, content: string, options: { force?: boolean } = {}) {
  const { force = false } = options;
  try {
    if (!force) {
      await fs.access(filePath);
      return false;
    }
  } catch (error) {
    // File does not exist, safe to write
  }

  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

export async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    return undefined;
  }
}

export async function writeJsonFile(filePath: string, data: unknown, options: { force?: boolean } = {}) {
  await writeFileSafe(filePath, `${JSON.stringify(data, null, 2)}\n`, options);
}
