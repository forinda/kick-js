import { pathToFileURL } from 'node:url'

/**
 * Import a user file — a schema, a seed — the way the app's own code
 * resolves: through jiti, so TypeScript files and extensionless relative
 * imports (`import { db } from '../src/db/client'`) work. Node's built-in
 * TypeScript support needs an extension on every relative import, which
 * bundler-style app code doesn't write.
 */
export async function loadModule(absPath: string): Promise<Record<string, unknown>> {
  if (!/\.[cm]?tsx?$/.test(absPath)) return import(pathToFileURL(absPath).href)
  const { createJiti } = await import('jiti')
  const jiti = createJiti(pathToFileURL(absPath).href, { interopDefault: false })
  return (await jiti.import(absPath)) as Record<string, unknown>
}
