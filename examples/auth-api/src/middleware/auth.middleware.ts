import { HttpException, type MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'

// Mock secret used for token encoding/decoding.
// In a real application this would come from environment variables.
const MOCK_SECRET = 'kickjs-auth-secret'

export interface TokenPayload {
  sub: string
  email: string
  iat: number
  exp: number
}

/**
 * Encode a payload into a mock JWT token.
 * This is NOT cryptographically secure -- it exists only to
 * demonstrate the auth guard pattern without pulling in a
 * real JWT library.
 */
export function createMockToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000)
  const full: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + 3600, // 1 hour
  }
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(full)).toString('base64url')
  const signature = Buffer.from(`${header}.${body}.${MOCK_SECRET}`).toString('base64url')
  return `${header}.${body}.${signature}`
}

/**
 * Decode and verify a mock JWT token.
 * Returns the payload or null if the token is invalid / expired.
 */
export function verifyMockToken(token: string): TokenPayload | null {
  try {
    const [header, body, signature] = token.split('.')
    if (!header || !body || !signature) return null

    const expectedSig = Buffer.from(`${header}.${body}.${MOCK_SECRET}`).toString('base64url')
    if (signature !== expectedSig) return null

    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null

    return payload
  } catch {
    return null
  }
}

/**
 * Auth guard middleware.
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the
 * mock token, and attaches the decoded payload to `ctx.req` so
 * downstream handlers can access the authenticated user.
 *
 * Usage with the @Middleware decorator:
 *
 *   @Middleware(authGuard)
 *   @Get('/me')
 *   async me(ctx: RequestContext) { ... }
 */
export const authGuard: MiddlewareHandler = (ctx: RequestContext, next: () => void) => {
  const authHeader = ctx.req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Missing or malformed Authorization header')
  }

  const token = authHeader.slice(7)
  const payload = verifyMockToken(token)
  if (!payload) {
    throw HttpException.unauthorized('Invalid or expired token')
  }

  // Attach the decoded user to the request so controllers can read it
  ;(ctx.req as any).user = payload
  next()
}
