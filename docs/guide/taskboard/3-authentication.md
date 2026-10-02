---
description: Add sign-in to Taskboard — a users table, scrypt password hashing, cookie sessions, a LoadUser context contributor that protects every route by default, and a @Public route flag.
---

# Taskboard, Part 3: Authentication

So far anyone can read and change every project. This part adds accounts: people register, sign in and sign out, and every route requires a signed-in user unless it says otherwise.

KickJS ships no authentication layer. You build it from primitives the framework does ship — a [context contributor](../context-decorators.md), a [route flag](../route-flags.md) and the [session middleware](../sessions.md) — in about a hundred lines you own. No upgrade can change how your users sign in. [Authentication](../authentication.md) explains why; the [BYO Auth recipe](../byo-recipes.md#auth) covers JWTs, API keys and multiple strategies.

## The users table

Add a `User` class to `src/db/schema.ts`, next to `Project`:

```ts
/** Someone who can sign in. */
export class User extends TableBase('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(254).notNull().unique(),
  name: varchar(100).notNull(),
  passwordHash: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
}) {}
```

`.unique()` puts a unique index on `email`. That index, not a "does this email exist?" query, is what stops two accounts sharing an address: a check-then-insert races when two requests arrive together, the index doesn't.

Generate the migration:

<PmCommand exec="kick db generate add_users" />

```sql
CREATE TABLE "users" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || ... )),
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
```

Read it, then mark it reviewed. `kick dev` applies it on the next start.

<PmCommand exec="kick db migrate review <id>" />

## Hashing passwords

Never store a password — store a slow, salted hash of it. Node's `crypto` module has `scrypt`, a hash built to be expensive to brute-force, so no dependency is needed:

```ts
// src/auth/password.ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

/** Hash a password as `salt:hash`, both hex. scrypt is in Node — no dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/** Check a password against a stored `salt:hash`, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':')
  const expected = Buffer.from(hash, 'hex')
  const actual = await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}
```

- A random salt per password means two users with the same password get different hashes.
- `timingSafeEqual` takes the same time however many bytes match, so response timing doesn't leak how close a guess was.

## The current user

Three pieces, in `src/auth/current-user.ts`:

```ts
import { defineHttpContextDecorator, defineRouteFlag, HttpException } from '@forinda/kickjs'
import { APP_DB } from '../db/token'

/** The signed-in user, as handlers see it. Never the password hash. */
export interface CurrentUser {
  id: string
  email: string
  name: string
}

declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: CurrentUser
  }
}

/** Marks a route that needs no sign-in: `@Public` on a method or a controller. */
export const Public = defineRouteFlag('auth.public')

/**
 * Loads the signed-in user from the session onto `ctx.get('user')`, or
 * answers 401. Registered for every route in `bootstrap()`; routes flagged
 * `@Public` skip it.
 */
export const LoadUser = defineHttpContextDecorator({
  key: 'user',
  deps: { db: APP_DB },
  skipWhen: 'auth.public',
  resolve: async (ctx, { db }) => {
    const userId = ctx.session?.data.userId as string | undefined
    const user = userId
      ? await db
          .selectFrom('users')
          .select(['id', 'email', 'name'])
          .where('id', '=', userId)
          .executeTakeFirst()
      : undefined
    if (!user) throw HttpException.unauthorized('Sign in first')
    return user
  },
})
```

- **`ContextMeta`** declares what `ctx.get('user')` holds, once, for the whole app.
- **`Public`** is a fact about a route — "no sign-in needed". It does nothing by itself.
- **`LoadUser`** is a contributor: it runs before the handler, reads the user id from the session, loads the user and puts it on the context — or answers `401`. `skipWhen: 'auth.public'` connects it to the flag: routes marked `@Public` never reach `resolve`.

The user is loaded from the database on every request rather than copied into the session. A deleted account stops working at once, and a renamed one shows its new name.

## Sessions and the secret

`session()` keeps a signed cookie holding a session id; the session data stays on the server. Signing needs a secret — add it to the env schema in `src/config/index.ts`:

```ts
const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    // Signs the session cookie. Generate one: openssl rand -hex 32
    SESSION_SECRET: z.string().min(32),
  }),
)
```

`min(32)` makes a short, guessable secret a startup error instead of a weakness you find later. The app refuses to boot without one, so set it in each env file:

```bash
# .env — your machine
SESSION_SECRET=<output of: openssl rand -hex 32>

# .env.example — committed, a placeholder
SESSION_SECRET=change-me-openssl-rand-hex-32

# .env.test — read instead of .env under vitest
SESSION_SECRET=test-secret-at-least-32-characters-long
```

See [Configuration](../configuration.md) for how the env files are read.

The middleware list has grown, so move it out of `src/index.ts` into `src/middleware/index.ts` — the entry file stays a list of names, and the tests below reuse the same list:

```ts
// src/middleware/index.ts
import { cors, helmet, requestId, requestLogger, session } from '@forinda/kickjs'
import express from 'express'
import { env } from '../config'

export const middlewares = [
  helmet(),
  cors({ origin: '*' }),
  requestId(),
  requestLogger(),
  // Express needs a body parser; Fastify and h3 parse bodies natively.
  express.json(),
  // A signed cookie holding the session id; the data lives server-side.
  session({ secret: env.SESSION_SECRET }),
]
```

## Protected by default

Register `LoadUser` for every route in `src/index.ts`:

```ts
import { middlewares } from './middleware'
import { LoadUser } from './auth/current-user'

export const app = await bootstrap({
  modules,
  runtime: expressRuntime(),
  adapters: [/* DevToolsAdapter, kickDbAdapter — unchanged */],
  middlewares,
  contributors: [LoadUser.registration],
})
```

Now every route requires a signed-in user, including the projects and tasks routes from Part 2 — you didn't touch them. The safe default is the one you get by forgetting: a new route is protected until you mark it `@Public`, not public until you remember to protect it.

## The auth module

Generate a module with a single controller file:

<PmCommand exec="kick g module auth --minimal --no-pluralize" />

`--no-pluralize` keeps the folder `src/modules/auth` rather than `auths`. Replace the generated CRUD routes with sign-in. First the request bodies, in `src/modules/auth/dtos/auth.dto.ts`:

```ts
import { z } from 'zod'

export const registerSchema = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
})

export const loginSchema = z.object({
  email: z.email(),
  password: z.string(),
})

export type RegisterDTO = z.infer<typeof registerSchema>
export type LoginDTO = z.infer<typeof loginSchema>
```

The service, `src/modules/auth/auth.service.ts`:

```ts
import { HttpException, Inject, Service } from '@forinda/kickjs'
import { UniqueViolationError } from '@forinda/kickjs-db'
import { APP_DB } from '../../db/token'
import type { AppDb } from '../../db/client'
import { hashPassword, verifyPassword } from '../../auth/password'
import type { CurrentUser } from '../../auth/current-user'
import type { LoginDTO, RegisterDTO } from './dtos/auth.dto'

@Service()
export class AuthService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async register(dto: RegisterDTO): Promise<CurrentUser> {
    try {
      return await this.db
        .insertInto('users')
        .values({
          email: dto.email.toLowerCase(),
          name: dto.name,
          passwordHash: await hashPassword(dto.password),
        })
        .returning(['id', 'email', 'name'])
        .executeTakeFirstOrThrow()
    } catch (err) {
      if (err instanceof UniqueViolationError)
        throw HttpException.conflict('Email already registered')
      throw err
    }
  }

  /** The user these credentials belong to — the same 401 whether the email or the password is wrong. */
  async login(dto: LoginDTO): Promise<CurrentUser> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', dto.email.toLowerCase())
      .executeTakeFirst()
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw HttpException.unauthorized('Wrong email or password')
    }
    return { id: user.id, email: user.email, name: user.name }
  }
}
```

- Emails are lowercased on the way in and on lookup, so `Ada@example.com` and `ada@example.com` are one account.
- A duplicate email surfaces as the unique index's `UniqueViolationError` — kick/db turns the driver's error into a typed one ([Errors](../database/errors.md)) — and becomes a `409`.
- `.returning(['id', 'email', 'name'])` never selects the hash, so it can't leak into a response.
- Login answers the same `401` for an unknown email and a wrong password. Different answers would tell an attacker which emails have accounts.

The controller, `src/modules/auth/auth.controller.ts`:

```ts
import { Autowired, Controller, Get, Post, reply, type Ctx } from '@forinda/kickjs'
import { Public } from '../../auth/current-user'
import { AuthService } from './auth.service'
import { loginSchema, registerSchema } from './dtos/auth.dto'

@Controller()
export class AuthController {
  @Autowired() private readonly auth!: AuthService

  @Public
  @Post('/register', { body: registerSchema })
  async register(ctx: Ctx<KickRoutes.AuthController['register']>) {
    const user = await this.auth.register(ctx.body)
    await signIn(ctx, user.id)
    return reply.created(user)
  }

  @Public
  @Post('/login', { body: loginSchema })
  async login(ctx: Ctx<KickRoutes.AuthController['login']>) {
    const user = await this.auth.login(ctx.body)
    await signIn(ctx, user.id)
    return user
  }

  @Post('/logout')
  async logout(ctx: Ctx<KickRoutes.AuthController['logout']>) {
    await ctx.session.destroy()
    return reply.noContent()
  }

  @Get('/me')
  me(ctx: Ctx<KickRoutes.AuthController['me']>) {
    return ctx.require('user')
  }
}

/** A fresh session id on sign-in, so an id planted before it can't be reused. */
async function signIn(ctx: Ctx<KickRoutes.AuthController['login']>, userId: string) {
  await ctx.session.regenerate()
  ctx.session.data.userId = userId
  await ctx.session.save()
}
```

- `register` and `login` are `@Public` — you can't be signed in before you sign in. `logout` and `me` aren't, so `LoadUser` has already rejected anyone signed out.
- `session.regenerate()` issues a new session id at sign-in. Without it, an attacker who planted a session id in a victim's browser before they signed in would share the signed-in session (session fixation).
- `ctx.require('user')` returns the user typed as `CurrentUser`, or throws if it isn't set. `ctx.get('user')` is `CurrentUser | undefined`, because TypeScript can't know `LoadUser` ran. Use `require` in handlers that can only run signed in.

Trim `auth.module.ts` to the one route set:

```ts
import { defineModule } from '@forinda/kickjs'
import { AuthController } from './auth.controller'

import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./**/*.d.ts'], { eager: true })

export const AuthModule = defineModule({
  name: 'AuthModule',
  build: () => ({
    routes() {
      return { path: '/auth', controller: AuthController }
    },
  }),
})
```

`kick g module` already mounted it in `src/modules/index.ts`.

Projects and tasks don't read the user yet: any signed-in user still sees every project. Part 4 scopes them to their members, using `ctx.require('user')`.

## Try it

Start the dev server with `kick dev`, then use a cookie jar so curl keeps the session cookie like a browser:

```bash
curl -s localhost:3000/api/v1/projects
# {"status":401,"detail":"Sign in first","type":"about:blank","title":"Unauthorized"}

curl -s -c jar -b jar -X POST localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse battery"}'
# {"id":"59e74005-…","email":"ada@example.com","name":"Ada"}

curl -s -b jar localhost:3000/api/v1/auth/me
# {"id":"59e74005-…","email":"ada@example.com","name":"Ada"}

curl -s -c jar -b jar -X POST localhost:3000/api/v1/auth/logout -o /dev/null -w '%{http_code}\n'
# 204

curl -s -b jar localhost:3000/api/v1/auth/me
# {"status":401,"detail":"Sign in first","type":"about:blank","title":"Unauthorized"}
```

::: warning Validation runs before the user is loaded
Body validation runs before contributors ([Authorization → ordering](../authorization.md#when-to-use-what)), so a signed-out request with an invalid body gets `422`, not `401`. Don't rely on the status code alone to tell "signed out" from "bad input" in a client — a request with a valid body still gets the `401`.
:::

## Testing signed in

Tests now need what `src/index.ts` has: the session middleware and the `LoadUser` contributor. Put that in one helper, `test/app.ts`, so no test assembles the app by hand:

```ts
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

import { createTestDb } from './db'
import { APP_DB } from '../src/db/token'
import { LoadUser } from '../src/auth/current-user'
import { middlewares } from '../src/middleware'
import { AuthModule } from '../src/modules/auth/auth.module'
import { ProjectModule } from '../src/modules/projects/project.module'
import { TaskModule } from '../src/modules/tasks/task.module'

/**
 * The whole app on a fresh in-memory database, with the same middleware and
 * contributors as `src/index.ts`. Each agent keeps its own cookies, like a
 * separate browser — `signUp` gives you a signed-in one.
 */
export async function testApp() {
  Container.reset()
  const { app } = await createTestApp({
    modules: [AuthModule(), ProjectModule(), TaskModule()],
    middlewares,
    contributors: [LoadUser.registration],
    overrides: [[APP_DB, createTestDb()]],
  })
  const handler = app.handle.bind(app)
  const agent = () => request.agent(handler)
  const signUp = async (email: string) => {
    const user = agent()
    await user
      .post('/api/v1/auth/register')
      .send({ email, name: email.split('@')[0], password: 'correct horse battery' })
      .expect(201)
    return user
  }
  return { agent, signUp }
}

/** A signed-out agent on a fresh app. */
export async function bootApp() {
  return (await testApp()).agent()
}

/** A signed-in agent on a fresh app. */
export async function signedIn(email = 'ada@example.com') {
  return (await testApp()).signUp(email)
}
```

`request.agent()` keeps cookies between requests, so an agent that registered stays signed in. `testApp()` hands out several agents on one app — Part 4 uses that to test one user against another.

The project and task controller tests switch to `signedIn()` in place of their own `createTestApp` call: they now get a signed-in agent on the full app, and the routes they test are protected.

The auth tests, `src/modules/auth/__tests__/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { bootApp, signedIn } from '../../../../test/app'

const ada = { email: 'ada@example.com', name: 'Ada', password: 'correct horse battery' }

describe('auth', () => {
  it('registers, signs in and reads the current user', async () => {
    const agent = await bootApp()
    const res = await agent.post('/api/v1/auth/register').send(ada)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: expect.any(String), email: ada.email, name: 'Ada' })

    const me = await agent.get('/api/v1/auth/me')
    expect(me.body.email).toBe(ada.email)
  })

  it('never returns the password hash', async () => {
    const agent = await bootApp()
    const res = await agent.post('/api/v1/auth/register').send(ada)
    expect(res.body).not.toHaveProperty('passwordHash')
  })

  it('answers 409 for an email already registered, in any case', async () => {
    const agent = await bootApp()
    await agent.post('/api/v1/auth/register').send(ada).expect(201)
    const again = await agent
      .post('/api/v1/auth/register')
      .send({ ...ada, email: 'ADA@example.com' })
    expect(again.status).toBe(409)
  })

  it('signs in with the right password only', async () => {
    const agent = await bootApp()
    await agent.post('/api/v1/auth/register').send(ada)
    await agent.post('/api/v1/auth/logout').expect(204)

    await agent
      .post('/api/v1/auth/login')
      .send({ ...ada, password: 'wrong' })
      .expect(401)
    await agent.get('/api/v1/auth/me').expect(401)

    await agent.post('/api/v1/auth/login').send(ada).expect(200)
    await agent.get('/api/v1/auth/me').expect(200)
  })

  it('protects everything not marked @Public', async () => {
    const agent = await bootApp()
    await agent.get('/api/v1/projects').expect(401)
    await agent.post('/api/v1/projects').send({ name: 'Launch' }).expect(401)

    const user = await signedIn()
    await user.get('/api/v1/projects').expect(200)
  })
})
```

The last test is the one to keep: it fails the day someone registers a route outside the protection.

<PmCommand run="test" />

## What you built

- A `users` table whose unique index, not application code, guarantees one account per email.
- Password hashing with Node's own `scrypt`, compared in constant time.
- Cookie sessions signed with a secret the app refuses to start without.
- A `LoadUser` contributor that makes every route require a user, and a `@Public` flag for the exceptions.
- Register, login, logout and `me`, with a fresh session id at sign-in and one `401` for every bad credential.
- A test helper that boots the real app with signed-in agents.

**Next:** [Part 4: Teams and Permissions](./4-teams-permissions.md) — projects belong to their members, owners invite people, and a transaction keeps a project and its owner together.
