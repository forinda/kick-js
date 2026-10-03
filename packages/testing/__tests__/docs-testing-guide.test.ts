/**
 * The examples in docs/guide/testing.md and docs/guide/testing/*, run as
 * written so the guide can't drift from the code.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Middleware,
  Post,
  Service,
  createToken,
  upload,
  type AppAdapter,
  type MiddlewareHandler,
  type RequestContext,
} from '@forinda/kickjs'
import { createTestApp, createTestModule } from '../src/index'

interface User {
  id: string
  email: string
}
interface UserRepository {
  findAll(): Promise<User[]>
  findById(id: string): Promise<User | null>
  delete(id: string): Promise<void>
}
const USER_REPOSITORY = createToken<UserRepository>('app/Users/repository')

class InMemoryUserRepository implements UserRepository {
  constructor(private users: User[] = [{ id: 'u1', email: 'ada@x.io' }]) {}
  async findAll() {
    return this.users
  }
  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null
  }
  async delete(id: string) {
    this.users = this.users.filter((u) => u.id !== id)
  }
}

@Service()
class Notifier {
  async send(_to: string, _text: string) {
    return 'sent'
  }
}

@Controller()
class UserController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: UserRepository,
    private readonly notifier: Notifier,
  ) {}

  @Get('/')
  async list() {
    return { data: await this.repo.findAll() }
  }

  @Get('/:id')
  async get(ctx: RequestContext) {
    const user = await this.repo.findById(ctx.params.id)
    if (!user) throw HttpException.notFound('User not found')
    return { data: user }
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    await this.notifier.send('ops@x.io', `deleted ${ctx.params.id}`)
    ctx.noContent()
  }

  @Post('/avatar')
  @Middleware(upload.single('file', { maxSize: 1024 }))
  avatar(ctx: RequestContext) {
    return { name: ctx.file?.originalname, size: ctx.file?.size }
  }
}

const UserModule = createTestModule({
  register: (c) => {
    c.registerFactory(USER_REPOSITORY, () => new InMemoryUserRepository())
  },
  routes: () => ({ path: '/users', controller: UserController }),
})

describe('testing guide examples', () => {
  it('overrides a token binding and drives the real controller', async () => {
    const { client } = await createTestApp({
      modules: [UserModule],
      overrides: [[USER_REPOSITORY, new InMemoryUserRepository([{ id: 'u9', email: 'x@x.io' }])]],
    })
    const api = client({ basePath: '/api/v1' })
    expect((await api.get('/users').expect(200)).body).toEqual({
      data: [{ id: 'u9', email: 'x@x.io' }],
    })
  })

  it('answers a thrown HttpException as Problem Details', async () => {
    const { client } = await createTestApp({ modules: [UserModule] })
    const res = await client().get('/api/v1/users/nope').expect(404)
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/)
    expect(res.body).toMatchObject({ status: 404, detail: 'User not found' })
  })

  it('spies on a real service resolved from the container', async () => {
    const { client, container } = await createTestApp({ modules: [UserModule] })
    const send = vi.spyOn(container.resolve(Notifier), 'send')
    await client().delete('/api/v1/users/u1').expect(204)
    expect(send).toHaveBeenCalledWith('ops@x.io', 'deleted u1')
  })

  it('uploads a file, and refuses one over the limit', async () => {
    const { client } = await createTestApp({ modules: [UserModule] })
    const api = client({ basePath: '/api/v1' })
    const ok = await api
      .post('/users/avatar')
      .attach('file', Buffer.from('hello'), 'a.txt')
      .expect(200)
    expect(ok.body).toEqual({ name: 'a.txt', size: 5 })
    await api.post('/users/avatar').attach('file', Buffer.alloc(2048), 'big.bin').expect(413)
  })

  it('runs adapter lifecycle hooks during createTestApp', async () => {
    const order: string[] = []
    const adapter: AppAdapter = {
      name: 'TestAdapter',
      beforeMount: () => {
        order.push('beforeMount')
      },
      beforeStart: () => {
        order.push('beforeStart')
      },
    }
    await createTestApp({ modules: [UserModule], adapters: [adapter] })
    expect(order).toEqual(['beforeMount', 'beforeStart'])
  })

  it('unit-tests a middleware, then checks it is attached', async () => {
    const requireTenantHeader: MiddlewareHandler<RequestContext> = (ctx, next) => {
      if (!ctx.headers['x-tenant']) throw HttpException.badRequest('x-tenant is required')
      next()
    }
    const next = vi.fn()
    requireTenantHeader({ headers: { 'x-tenant': 'acme' } } as never, next)
    expect(next).toHaveBeenCalledOnce()
    expect(() => requireTenantHeader({ headers: {} } as never, vi.fn())).toThrow(
      'x-tenant is required',
    )

    @Controller()
    @Middleware(requireTenantHeader)
    class ProjectController {
      @Get('/')
      list() {
        return []
      }
    }
    const ProjectModule = createTestModule({
      register: () => {},
      routes: () => ({ path: '/projects', controller: ProjectController }),
    })
    const { client } = await createTestApp({ modules: [ProjectModule] })
    await client().get('/api/v1/projects').expect(400)
    await client().withHeaders({ 'x-tenant': 'acme' }).get('/api/v1/projects').expect(200)
  })
})
