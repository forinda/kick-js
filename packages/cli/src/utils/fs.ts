import { writeFile, mkdir, access, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Write a file, creating parent directories if needed */
export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

/** Ensure a directory exists */
export async function ensureDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** Check if a file exists */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** Read a JSON file */
export async function readJsonFile<T = any>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8')
  return JSON.parse(content)
}
