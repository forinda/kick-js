import { pathToFileURL } from 'node:url'

/**
 * Import a user file — a schema, a seed — the way the app's own code
 * resolves: through jiti, so TypeScript and JavaScript files alike can use
 * extensionless relative imports (`import { db } from '../src/db/client'`). Node's built-in
 * TypeScript support needs an extension on every relative import, which
 * bundler-style app code doesn't write.
 */
export async function loadModule(
  absPath: string,
  options: { fresh?: boolean } = {},
): Promise<Record<string, unknown>> {
  const { createJiti } = await import('jiti')
  // `fresh` reads the file as it is now, not a copy cached from an earlier
  // load in the same process — a migration edited between two runs.
  const jiti = createJiti(pathToFileURL(absPath).href, {
    interopDefault: false,
    ...(options.fresh ? { moduleCache: false, fsCache: false } : {}),
  })
  return (await jiti.import(absPath)) as Record<string, unknown>
}
