---
title: 'Building JWT Auth with Refresh Token Rotation in KickJS'
description: "How I bypassed a framework's built-in auth system and implemented JWT authentication with refresh token rotation from scratch using middleware, guards, and typed helpers."
tags: ['kickjs', 'nodejs', 'typescript', 'mongodb', 'jwt']
canonical_url: ''
published: false
cover_image: ''
---

# Building JWT Auth with Refresh Token Rotation Without a Framework Auth Adapter

Most Node.js frameworks ship with an authentication adapter. You configure it, decorate your public routes, and everything just works. That was the plan when I started building Vibed, a task management backend with KickJS. The framework had an `AuthAdapter` with JWT strategy support, a `@Public()` decorator, and configurable default policies.

I configured all of it. Then I spent a day figuring out why none of it worked the way I expected. In the end, I threw out the built-in auth adapter for route protection and built the entire JWT auth flow by hand -- registration, login, access tokens, refresh token rotation, and a layered guard system for workspace and project access.

This article walks through the full implementation with real code from the Vibed codebase.

::: warning `@forinda/kickjs-auth` was removed in v8
`AuthAdapter`, `JwtStrategy` and `@Public()` in the next section came from `@forinda/kickjs-auth`, which no longer ships. Its replacement is the [BYO Auth recipe](./byo-recipes.md#auth): the user is loaded by a context contributor and `@Public` is a [route flag](./route-flags.md), both resolved per route after matching, so the timing problem described below does not apply to it. The rest of this tutorial — the middleware, token rotation and guards — does not depend on the removed package.
:::

## Why the Built-In AuthAdapter Did Not Work

KickJS provides an `AuthAdapter` that runs during the `beforeRoutes` lifecycle phase. You configure it with a JWT strategy and a default policy:

```typescript
AuthAdapter({
  strategies: [
    JwtStrategy({
      secret: getEnv('JWT_SECRET'),
      mapPayload: (payload: any) => ({
        id: payload.sub,
        email: payload.email,
        globalRole: payload.globalRole ?? 'user',
      }),
    }),
  ],
  defaultPolicy: 'protected',
})
```

The idea is that `defaultPolicy: 'protected'` makes all routes require a valid JWT by default. You mark exceptions with `@Public()`:

```typescript
@Post('/login')
@Public()
async login(ctx: RequestContext) { ... }
```

The problem is timing. The `AuthAdapter` runs during the `beforeRoutes` phase, before controllers are mounted. At that point, it sets up global Express middleware that checks for JWTs. But the `@Public()` decorator is metadata attached to controller methods -- and route metadata is only resolved when routes are actually built and mounted.

The result: the global auth middleware cannot read `@Public()` metadata because the routes do not exist yet when it runs. Every request either gets blocked (if `defaultPolicy: 'protected'`) or passes through (if `defaultPolicy: 'open'`). The `@Public()` decorator does nothing.

I set `defaultPolicy: 'protected'` and configured it in our adapters:

```typescript
export const adapters = [
  MongooseAdapter(getEnv('MONGODB_URI')),
  RedisAdapter(getEnv('REDIS_URL')),
  AuthAdapter({
    strategies: [
      JwtStrategy({
        secret: getEnv('JWT_SECRET'),
        mapPayload: (payload: any) => ({
          id: payload.sub,
          email: payload.email,
          globalRole: payload.globalRole ?? 'user',
        }),
      }),
    ],
    defaultPolicy: 'protected',
  }),
  // ... other adapters
]
```

The `AuthAdapter` with `defaultPolicy: 'protected'` validated JWTs globally and stored the decoded user on `req`. In the end we dropped it: validating the JWT and deciding which routes are protected both moved into a middleware applied at the controller level.

## The authBridgeMiddleware Approach

Instead of relying on the adapter's policy system, I built a small bridge middleware that verifies the bearer token and makes the user available through the context API:

```typescript
import jwt from 'jsonwebtoken'
import { getEnv, HttpException, type MiddlewareHandler, type RequestContext } from '@forinda/kickjs'

export const authBridgeMiddleware: MiddlewareHandler<RequestContext> = (ctx, next) => {
  const header = ctx.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Authentication required')
  }
  try {
    const payload = jwt.verify(header.slice(7), getEnv('JWT_SECRET')) as jwt.JwtPayload
    ctx.set('user', {
      id: payload.sub,
      email: payload.email,
      globalRole: payload.globalRole ?? 'user',
    })
  } catch {
    throw HttpException.unauthorized('Invalid or expired token')
  }
  next()
}
```

Protected controllers apply this middleware at the class level. Public controllers (like auth) do not apply it at all:

```typescript
// Protected -- requires auth
@Controller()
@Middleware(authBridgeMiddleware)
export class TasksController { ... }

// Public -- no auth middleware
@Controller()
export class AuthController { ... }
```

This gives me explicit control. There is no magic. If a controller has `@Middleware(authBridgeMiddleware)`, its routes require authentication. If it does not, they are open. The auth controller for registration and login has no auth middleware -- it is public by design.

## The Typed getUser Helper

Reading the user in every handler via `ctx.get('user')` is verbose and returns an optional type. I wrapped it in a helper:

```typescript
import type { RequestContext } from '@forinda/kickjs'
import { HttpException } from '@forinda/kickjs'

export interface AuthUser {
  id: string
  email: string
  globalRole: string
}

export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.get<AuthUser>('user')
  if (!user) {
    throw HttpException.unauthorized('Authentication required')
  }
  return user
}
```

This gives me a typed `AuthUser` return with an automatic 401 if the user is missing. Every protected handler can call `getUser(ctx)` and trust the return type without null checks.

## The Full Auth Flow

Here is the complete flow: register, login, use access token, refresh, logout.

### Registration

The registration DTO uses Zod for validation:

```typescript
import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
})

export type RegisterDto = z.infer<typeof registerSchema>
```

The use case hashes the password, creates the user, generates both tokens, and queues a welcome email:

```typescript
@Service()
export class RegisterUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  async execute(dto: RegisterDto) {
    const existing = await this.userRepo.findByEmail(dto.email)
    if (existing) {
      throw HttpException.conflict(ErrorCode.EMAIL_ALREADY_EXISTS)
    }

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.userRepo.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      globalRole: 'user',
      isActive: true,
    })

    const accessToken = this.generateAccessToken(user)
    const refreshToken = uuidv4()
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await this.refreshTokenRepo.create({
      userId: user._id.toString(),
      token: refreshToken,
      expiresAt: refreshExpiresAt,
    })

    // Queue welcome email
    try {
      await this.queueService.add(
        'email',
        'send-welcome-email',
        {
          email: user.email,
          firstName: user.firstName,
        },
        { delay: 5000 },
      )
    } catch (err) {
      logger.warn('Failed to queue welcome email — continuing registration')
    }

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        globalRole: user.globalRole,
      },
      accessToken,
      refreshToken,
    }
  }

  private generateAccessToken(user: any): string {
    return jwt.sign(
      { sub: user._id.toString(), email: user.email, globalRole: user.globalRole },
      getEnv('JWT_SECRET'),
      { expiresIn: getEnv('JWT_ACCESS_EXPIRES_IN') as any },
    )
  }
}
```

Notice the DI pattern: `@Inject(TOKENS.USER_REPOSITORY)` in the constructor injects the repository interface implementation. `@Inject(QUEUE_MANAGER)` injects the queue service registered by `QueueAdapter` from `@forinda/kickjs-queue`. These are typed `createToken<T>()` tokens: `@Inject(TOKEN)` on a constructor parameter and `@Autowired(TOKEN)` on a property both resolve them.

### Login

Login validates credentials, updates the last login timestamp, and issues both tokens:

```typescript
@Service()
export class LoginUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: LoginDto) {
    const user = await this.userRepo.findByEmail(dto.email)
    if (!user) {
      throw HttpException.unauthorized(ErrorCode.INVALID_CREDENTIALS)
    }

    if (!user.isActive) {
      throw HttpException.forbidden(ErrorCode.USER_INACTIVE)
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!isPasswordValid) {
      throw HttpException.unauthorized(ErrorCode.INVALID_CREDENTIALS)
    }

    await this.userRepo.update(user._id.toString(), { lastLoginAt: new Date() })

    const accessToken = jwt.sign(
      { sub: user._id.toString(), email: user.email, globalRole: user.globalRole },
      getEnv('JWT_SECRET'),
      { expiresIn: getEnv('JWT_ACCESS_EXPIRES_IN') as any },
    )

    const refreshToken = uuidv4()
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await this.refreshTokenRepo.create({
      userId: user._id.toString(),
      token: refreshToken,
      expiresAt: refreshExpiresAt,
    })

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        globalRole: user.globalRole,
      },
      accessToken,
      refreshToken,
    }
  }
}
```

The response includes a short-lived access token (15 minutes by default, configured via `JWT_ACCESS_EXPIRES_IN` env var) and a long-lived refresh token (7 days). The env schema enforces these defaults:

```typescript
const envSchema = defineEnv((base) =>
  base.extend({
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    // ...
  }),
)
```

### Refresh Token Rotation

This is where the security gets interesting. When a client uses a refresh token to get a new access token, we do not just return a new access token. We also invalidate the old refresh token and issue a new one. This is refresh token rotation.

```typescript
@Service()
export class RefreshTokenUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: RefreshTokenDto) {
    const stored = await this.refreshTokenRepo.findByToken(dto.refreshToken)
    if (!stored || stored.expiresAt < new Date()) {
      throw HttpException.unauthorized(ErrorCode.TOKEN_EXPIRED)
    }

    const user = await this.userRepo.findById(stored.userId.toString())
    if (!user || !user.isActive) {
      throw HttpException.unauthorized(ErrorCode.USER_NOT_FOUND)
    }

    // Rotate: delete old, create new
    await this.refreshTokenRepo.deleteByToken(dto.refreshToken)
    const newRefreshToken = uuidv4()
    await this.refreshTokenRepo.create({
      userId: user._id.toString(),
      token: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    const accessToken = jwt.sign(
      { sub: user._id.toString(), email: user.email, globalRole: user.globalRole },
      getEnv('JWT_SECRET'),
      { expiresIn: getEnv('JWT_ACCESS_EXPIRES_IN') as any },
    )

    return { accessToken, refreshToken: newRefreshToken }
  }
}
```

Why rotate? If an attacker steals a refresh token, they can use it exactly once. The next time the legitimate user tries to refresh, the token is gone -- the request fails, and the user knows something is wrong. Without rotation, a stolen refresh token is valid for its entire 7-day lifetime.

The refresh token is stored in MongoDB with a TTL index that auto-cleans expired tokens:

```typescript
const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
)

export const RefreshTokenModel =
  (mongoose.models.RefreshToken as mongoose.Model<RefreshTokenDocument>) ||
  mongoose.model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema)
```

The `index: { expires: 0 }` on `expiresAt` is a MongoDB TTL index. Documents are automatically deleted when `expiresAt` passes. We do not need a cron job to clean up expired tokens (though we run one as a safety net).

### Logout

Logout simply deletes the refresh token:

```typescript
@Service()
export class LogoutUseCase {
  constructor(
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(refreshToken: string) {
    await this.refreshTokenRepo.deleteByToken(refreshToken)
  }
}
```

The access token remains valid until it expires (up to 15 minutes). For immediate invalidation, you would need a token blacklist -- which adds complexity. For most applications, the 15-minute window is an acceptable trade-off.

### The Auth Controller

The controller ties it all together. Notice there is no `@Middleware(authBridgeMiddleware)` -- all routes are public:

```typescript
@ApiTags('Auth')
@Controller()
export class AuthController {
  @Autowired() private registerUseCase!: RegisterUseCase
  @Autowired() private loginUseCase!: LoginUseCase
  @Autowired() private refreshTokenUseCase!: RefreshTokenUseCase
  @Autowired() private logoutUseCase!: LogoutUseCase

  @Post('/register', { body: registerSchema })
  @ApiOperation({ summary: 'Register a new user account' })
  async register(ctx: RequestContext) {
    return reply.created(await this.registerUseCase.execute(ctx.body))
  }

  @Post('/login', { body: loginSchema })
  @ApiOperation({ summary: 'Log in with credentials' })
  async login(ctx: RequestContext) {
    return this.loginUseCase.execute(ctx.body)
  }

  @Post('/refresh', { body: refreshTokenSchema })
  @ApiOperation({ summary: 'Refresh an access token' })
  async refresh(ctx: RequestContext) {
    return this.refreshTokenUseCase.execute(ctx.body)
  }

  @Post('/logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and invalidate refresh token' })
  async logout(ctx: RequestContext) {
    const { refreshToken } = ctx.body
    await this.logoutUseCase.execute(refreshToken)
    return reply.noContent()
  }
}
```

Handlers return their result (`reply` from `@forinda/kickjs` sets a non-200 status). The access control is structural -- no `authBridgeMiddleware` means no auth check.

## Guards: Layered Authorization

Authentication (who are you?) is step one. Authorization (what can you access?) requires guards. In Vibed, access is hierarchical: you must be a workspace member to access a workspace, and workspace membership is checked before project access.

The workspace membership guard:

```typescript
export const workspaceMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = ctx.get('user')
  if (!user) {
    throw HttpException.unauthorized('Authentication required')
  }

  const workspaceId = ctx.params.workspaceId
  if (!workspaceId) return next()

  const container = Container.getInstance()
  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  )
  const member = await memberRepo.findByUserAndWorkspace(user.id, workspaceId)

  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER)
  }

  ctx.set('workspaceMember', member)
  next()
}
```

The role-checking factory wraps this further:

```typescript
export function requireWorkspaceRole(...roles: string[]): MiddlewareHandler {
  return async (ctx: RequestContext, next) => {
    const member = ctx.get('workspaceMember')
    if (!member) {
      throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER)
    }

    if (!roles.includes(member.role)) {
      throw HttpException.forbidden(ErrorCode.FORBIDDEN)
    }

    next()
  }
}
```

The channel membership guard handles both public and private channels:

```typescript
export const channelMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = ctx.get('user')
  if (!user) {
    throw HttpException.unauthorized('Authentication required')
  }

  const channelId = ctx.params.channelId
  if (!channelId) return next()

  const container = Container.getInstance()
  const channelRepo = container.resolve<IChannelRepository>(TOKENS.CHANNEL_REPOSITORY)
  const channel = await channelRepo.findById(channelId)

  if (!channel) {
    throw HttpException.notFound(ErrorCode.CHANNEL_NOT_FOUND)
  }

  if (channel.type === 'private') {
    const isMember = channel.memberIds.some((id) => id.toString() === user.id)
    if (!isMember) {
      throw HttpException.forbidden(ErrorCode.NOT_CHANNEL_MEMBER)
    }
  }

  ctx.set('channel', channel)
  next()
}
```

Guards stack. A route like `POST /projects/:projectId/tasks` applies the auth bridge first, then the project access guard, which internally checks workspace membership:

```typescript
@Post('/projects/:projectId/tasks', {
  params: z.object({ projectId: z.string() }),
  body: createTaskSchema,
})
@Middleware(projectAccessGuard)
async create(ctx: RequestContext) {
  const user = getUser(ctx)
  const result = await this.createTaskUseCase.execute(ctx.params.projectId, user.id, ctx.body)
  return reply.created(result)
}
```

## What I Learned

**Framework auth adapters optimize for the common case.** If your app has mostly protected routes with a few public ones, the `defaultPolicy: 'protected'` + `@Public()` pattern is elegant. But when the adapter's lifecycle does not align with how route metadata is resolved, you end up fighting the framework.

**Manual auth is more work but more transparent.** I know exactly which routes are protected because I can see the `@Middleware(authBridgeMiddleware)` decorator. There is no global policy to reason about, no decorator timing issues, no hidden behavior.

**Refresh token rotation is cheap insurance.** The implementation is three extra lines: delete the old token, generate a new one, save it. The security benefit -- limiting the blast radius of a stolen refresh token -- is significant.

**Typed helpers over raw context access.** The `getUser(ctx)` pattern costs five minutes to write and saves hours of debugging missing auth checks. If the user is not there, you get a 401 instead of a cryptic null reference downstream.

**Guards compose naturally as middleware.** Each guard reads what the previous one set, adds its own data, and passes control. The DI container is available anywhere via `Container.getInstance()`, so guards can resolve repositories without being classes themselves.

The full flow -- register, login, refresh with rotation, guarded access, logout -- is about 300 lines of application code spread across focused use cases. No framework auth magic, no hidden behavior, and it works exactly the way I expect it to.
