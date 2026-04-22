import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Put, Delete, Inject, Service } from '@forinda/kickjs'
import type { RequestContext, ParsedQuery } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  USER_REPOSITORY,
  type IUserRepository,
  type User,
  type NewUser,
} from '../domain/repositories/user.repository'
import { GetUserUseCase } from '../application/use-cases/get-user.use-case'
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case'
import { DeleteUserUseCase } from '../application/use-cases/delete-user.use-case'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryUserRepository implements IUserRepository {
  private users: User[] = [
    {
      id: 'u1',
      email: 'alice@test.com',
      firstName: 'Alice',
      lastName: 'Smith',
      passwordHash: 'hash',
      globalRole: 'user',
      isActive: true,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'u2',
      email: 'bob@test.com',
      firstName: 'Bob',
      lastName: 'Jones',
      passwordHash: 'hash',
      globalRole: 'superadmin',
      isActive: true,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null
  }

  async findAll() {
    return this.users
  }

  async findPaginated(parsed: ParsedQuery) {
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: this.users.slice(start, start + limit), total: this.users.length }
  }

  async create(dto: NewUser) {
    const user: User = {
      id: `u${this.users.length + 1}`,
      email: dto.email,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      passwordHash: dto.passwordHash,
      globalRole: dto.globalRole ?? 'user',
      isActive: true,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.users.push(user)
    return user
  }

  async update(id: string, dto: Partial<NewUser>) {
    const user = this.users.find((u) => u.id === id)
    if (!user) throw new Error('Not found')
    Object.assign(user, dto, { updatedAt: new Date() })
    return user
  }

  async delete(id: string) {
    this.users = this.users.filter((u) => u.id !== id)
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestUserController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const users = await this.repo.findAll()
    ctx.json({ data: users, total: users.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const user = await this.repo.findById(ctx.params.id)
    if (!user) return ctx.notFound('User not found')
    ctx.json({ data: user })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('UserController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(USER_REPOSITORY, () => new InMemoryUserRepository())
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

  it('DELETE /api/v1/users/:id removes the user', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/users/u1').expect(204)

    // Verify user is gone
    await request(expressApp).get('/api/v1/users/u1').expect(404)
  })

  it('DELETE then list shows reduced count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/users/u1').expect(204)

    const res = await request(expressApp).get('/api/v1/users').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].email).toBe('bob@test.com')
  })
})
