import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'

interface GenerateGuardOptions {
  name: string
  outDir: string
}

export async function generateGuard(options: GenerateGuardOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const camel = toCamelCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.guard.ts`)
  await writeFileSafe(
    filePath,
    `import { Container, HttpException } from '@kickjs/core'
import type { RequestContext } from '@kickjs/http'

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
