import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { ProjectPattern } from '../config'

interface GenerateGuardOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
  pluralize?: boolean
}

export async function generateGuard(options: GenerateGuardOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  const outDir = resolveOutDir({
    type: 'guard',
    outDir: options.outDir,
    moduleName,
    modulesDir,
    defaultDir: 'src/guards',
    pattern,
    shouldPluralize: options.pluralize ?? true,
  })
  const kebab = toKebabCase(name)
  const camel = toCamelCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.guard.ts`)
  await writeFileSafe(
    filePath,
    `import { Container, HttpException } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

/**
 * ${pascal} guard.
 *
 * Guards protect routes by checking conditions before the handler runs.
 * Return early with an error response to block access.
 *
 * Usage:
 *   @Middleware(${camel}Guard)
 *   @Get('/protected')
 *   async handler(ctx: RequestContext) { ... }
 */
export async function ${camel}Guard(ctx: RequestContext, next: () => void): Promise<void> {
  // Example: check for an authorization header
  const header = ctx.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    ctx.res.status(401).json({ message: 'Missing or invalid authorization header' })
    return
  }

  const token = header.slice(7)

  try {
    // Verify the token using a service from the DI container
    // const container = Container.getInstance()
    // const authService = container.resolve(AuthService)
    // const payload = authService.verifyToken(token)
    // ctx.set('auth', payload)

    next()
  } catch {
    ctx.res.status(401).json({ message: 'Invalid or expired token' })
  }
}
`,
  )
  files.push(filePath)

  return files
}
