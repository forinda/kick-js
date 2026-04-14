import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'

export interface AuthScaffoldOptions {
  /** Auth strategy: 'jwt' | 'session'. Default: 'jwt' */
  strategy?: 'jwt' | 'session'
  /** Output directory. Default: 'src/modules/auth' */
  outDir?: string
  /** Generate role-based guards. Default: true */
  roleGuards?: boolean
}

/**
 * Generate a complete auth module with registration, login, logout,
 * and password hashing. Uses PasswordService and the configured strategy.
 */
export async function generateAuthScaffold(options: AuthScaffoldOptions = {}): Promise<string[]> {
  const strategy = options.strategy ?? 'jwt'
  const outDir = options.outDir ?? 'src/modules/auth'
  const dtoDir = join(outDir, 'dto')
  const files: string[] = []

  // ── auth.module.ts ──────────────────────────────────────────────────
  const modulePath = join(outDir, 'auth.module.ts')
  await writeFileSafe(
    modulePath,
    `import { Module } from '@forinda/kickjs'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  controllers: [AuthController],
  services: [AuthService],
})
export class AuthModule {}
`,
  )
  files.push(modulePath)

  // ── auth.controller.ts ──────────────────────────────────────────────
  const controllerPath = join(outDir, 'auth.controller.ts')
  const controllerContent =
    strategy === 'jwt' ? jwtControllerTemplate() : sessionControllerTemplate()
  await writeFileSafe(controllerPath, controllerContent)
  files.push(controllerPath)

  // ── auth.service.ts ─────────────────────────────────────────────────
  const servicePath = join(outDir, 'auth.service.ts')
  const serviceContent = strategy === 'jwt' ? jwtServiceTemplate() : sessionServiceTemplate()
  await writeFileSafe(servicePath, serviceContent)
  files.push(servicePath)

  // ── dto/register.dto.ts ─────────────────────────────────────────────
  const registerDtoPath = join(dtoDir, 'register.dto.ts')
  await writeFileSafe(
    registerDtoPath,
    `import { z } from 'zod'

export const RegisterDto = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
})

export type RegisterInput = z.infer<typeof RegisterDto>
`,
  )
  files.push(registerDtoPath)

  // ── dto/login.dto.ts ────────────────────────────────────────────────
  const loginDtoPath = join(dtoDir, 'login.dto.ts')
  await writeFileSafe(
    loginDtoPath,
    `import { z } from 'zod'

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof LoginDto>
`,
  )
  files.push(loginDtoPath)

  // ── auth.test.ts ────────────────────────────────────────────────────
  const testPath = join(outDir, 'auth.test.ts')
  await writeFileSafe(
    testPath,
    `import { describe, it, expect } from 'vitest'

describe('Auth Module', () => {
  it.todo('POST /register — creates a new user')
  it.todo('POST /login — returns token for valid credentials')
  it.todo('POST /login — rejects invalid credentials')
  it.todo('POST /logout — invalidates session/token')
  it.todo('GET /me — returns authenticated user')
})
`,
  )
  files.push(testPath)

  // ── auth.guard.ts (optional) ────────────────────────────────────────
  if (options.roleGuards !== false) {
    const guardPath = join(outDir, 'auth.guard.ts')
    await writeFileSafe(
      guardPath,
      `import { Roles } from '@forinda/kickjs-auth'

/**
 * Role-based access guard.
 * Usage: @Roles('admin') on a controller method.
 *
 * The AuthAdapter extracts the user's roles from the JWT/session
 * and the framework checks them automatically.
 */
export const AdminOnly = Roles('admin')
export const ManagerOnly = Roles('manager')
`,
    )
    files.push(guardPath)
  }

  return files
}

// ── JWT Templates ───────────────────────────────────────────────────────

function jwtControllerTemplate(): string {
  return `import { Controller, Post, Get } from '@forinda/kickjs'
import { Authenticated, Public } from '@forinda/kickjs-auth'
import type { RequestContext } from '@forinda/kickjs'
import { Autowired } from '@forinda/kickjs'
import { AuthService } from './auth.service'

@Controller('/auth')
@Authenticated()
export class AuthController {
  @Autowired() private authService!: AuthService

  @Post('/register')
  @Public()
  async register(ctx: RequestContext) {
    const result = await this.authService.register(ctx.body)
    return ctx.created(result)
  }

  @Post('/login')
  @Public()
  async login(ctx: RequestContext) {
    const result = await this.authService.login(ctx.body)
    if (!result) return ctx.badRequest('Invalid credentials')
    return ctx.json(result)
  }

  @Post('/logout')
  async logout(ctx: RequestContext) {
    return ctx.json({ message: 'Logged out' })
  }

  @Get('/me')
  async me(ctx: RequestContext) {
    return ctx.json({ user: ctx.user })
  }
}
`
}

function jwtServiceTemplate(): string {
  return `import { Service, Autowired } from '@forinda/kickjs'
import { PasswordService } from '@forinda/kickjs-auth'
import type { RegisterInput } from './dto/register.dto'
import type { LoginInput } from './dto/login.dto'

// TODO: Replace with your User repository
const users = new Map<string, { id: string; email: string; name?: string; passwordHash: string }>()

@Service()
export class AuthService {
  @Autowired() private password!: PasswordService

  async register(input: RegisterInput) {
    const { email, password, name } = input

    if (users.has(email)) {
      throw new Error('User already exists')
    }

    const passwordHash = await this.password.hash(password)
    const id = crypto.randomUUID()
    users.set(email, { id, email, name, passwordHash })

    return { id, email, name }
  }

  async login(input: LoginInput) {
    const { email, password } = input
    const user = users.get(email)
    if (!user) return null

    const valid = await this.password.verify(user.passwordHash, password)
    if (!valid) return null

    // TODO: Generate JWT token here
    // const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET!)
    return { user: { id: user.id, email: user.email, name: user.name } }
  }
}
`
}

// ── Session Templates ───────────────────────────────────────────────────

function sessionControllerTemplate(): string {
  return `import { Controller, Post, Get } from '@forinda/kickjs'
import { Authenticated, Public } from '@forinda/kickjs-auth'
import { sessionLogin, sessionLogout } from '@forinda/kickjs-auth'
import type { RequestContext } from '@forinda/kickjs'
import { Autowired } from '@forinda/kickjs'
import { AuthService } from './auth.service'

@Controller('/auth')
@Authenticated()
export class AuthController {
  @Autowired() private authService!: AuthService

  @Post('/register')
  @Public()
  async register(ctx: RequestContext) {
    const result = await this.authService.register(ctx.body)
    return ctx.created(result)
  }

  @Post('/login')
  @Public()
  async login(ctx: RequestContext) {
    const user = await this.authService.login(ctx.body)
    if (!user) return ctx.badRequest('Invalid credentials')
    await sessionLogin(ctx.session, user)
    return ctx.json({ message: 'Logged in', user })
  }

  @Post('/logout')
  async logout(ctx: RequestContext) {
    await sessionLogout(ctx.session)
    return ctx.json({ message: 'Logged out' })
  }

  @Get('/me')
  async me(ctx: RequestContext) {
    return ctx.json({ user: ctx.user })
  }
}
`
}

function sessionServiceTemplate(): string {
  return `import { Service, Autowired } from '@forinda/kickjs'
import { PasswordService } from '@forinda/kickjs-auth'
import type { RegisterInput } from './dto/register.dto'
import type { LoginInput } from './dto/login.dto'

// TODO: Replace with your User repository
const users = new Map<string, { id: string; email: string; name?: string; passwordHash: string }>()

@Service()
export class AuthService {
  @Autowired() private password!: PasswordService

  async register(input: RegisterInput) {
    const { email, password, name } = input

    if (users.has(email)) {
      throw new Error('User already exists')
    }

    const passwordHash = await this.password.hash(password)
    const id = crypto.randomUUID()
    users.set(email, { id, email, name, passwordHash })

    return { id, email, name }
  }

  async login(input: LoginInput) {
    const { email, password } = input
    const user = users.get(email)
    if (!user) return null

    const valid = await this.password.verify(user.passwordHash, password)
    if (!valid) return null

    return { id: user.id, email: user.email, name: user.name }
  }
}
`
}
