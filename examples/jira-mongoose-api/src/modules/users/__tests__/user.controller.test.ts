import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import type { IUserRepository } from '../domain/repositories/user.repository'
import type { UserEntity } from '../domain/entities/user.entity'
import type { Types } from 'mongoose'
import { TOKENS } from '@/shared/constants/tokens'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryUserRepository implements IUserRepository {
  private users: UserEntity[] = [
    {
      _id: 'u1' as unknown as Types.ObjectId,
      email: 'alice@test.com',
      firstName: 'Alice',
      lastName: 'Smith',
      passwordHash: 'hash',
      globalRole: 'user',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 'u2' as unknown as Types.ObjectId,
      email: 'bob@test.com',
      firstName: 'Bob',
      lastName: 'Jones',
      passwordHash: 'hash',
      globalRole: 'superadmin',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.users.find((u) => String(u._id) === id) ?? null
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null
  }

  async create(data: Partial<UserEntity>) {
    const user: UserEntity = {
      _id: `u${this.users.length + 1}` as unknown as Types.ObjectId,
      email: data.email!,
      passwordHash: data.passwordHash ?? 'hash',
      firstName: data.firstName ?? 'Test',
      lastName: data.lastName ?? 'User',
      globalRole: data.globalRole ?? 'user',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.users.push(user)
    return user
  }

  async update(id: string, data: Partial<UserEntity>) {
    const user = this.users.find((u) => String(u._id) === id)
    if (!user) return null
    Object.assign(user, data, { updatedAt: new Date() })
    return user
  }

  async findPaginated() {
    return { data: this.users, total: this.users.length }
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestUserController {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({})
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const user = await this.repo.findById(ctx.params.id)
    if (!user) return ctx.notFound('User not found')
    ctx.json({ data: user })
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('UserController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(TOKENS.USER_REPOSITORY, () => new InMemoryUserRepository())
        c.register(TestUserController, TestUserController)
      },
      routes: () => ({
        path: '/users',
        router: buildRoutes(TestUserController),
        controller: TestUserController,
      }),
    })
  }

  it('GET /api/v1/users returns paginated user list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/users').expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.total).toBe(2)
    expect(res.body.data[0]).toHaveProperty('email', 'alice@test.com')
  })

  it('GET /api/v1/users/:id returns a single user', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/users/u1').expect(200)

    expect(res.body.data.email).toBe('alice@test.com')
    expect(res.body.data.firstName).toBe('Alice')
  })

  it('GET /api/v1/users/:id returns 404 for unknown user', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/users/unknown').expect(404)
  })
})
