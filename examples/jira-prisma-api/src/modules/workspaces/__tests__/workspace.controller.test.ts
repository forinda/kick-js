import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  WORKSPACE_REPOSITORY,
  type IWorkspaceRepository,
} from '../domain/repositories/workspace.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: any[] = [
    {
      id: 'ws1',
      name: 'Acme Corp',
      slug: 'acme-corp',
      description: null,
      ownerId: 'u1',
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.workspaces.find((w) => w.id === id) ?? null
  }
  async findBySlug(slug: string) {
    return this.workspaces.find((w) => w.slug === slug) ?? null
  }
  async findForUser() {
    return this.workspaces
  }
  async findPaginated() {
    return { data: this.workspaces, total: this.workspaces.length }
  }
  async create(dto: any) {
    const ws = {
      id: `ws${this.workspaces.length + 1}`,
      name: dto.name,
      slug: dto.name.toLowerCase().replace(/\s+/g, '-'),
      description: dto.description ?? null,
      ownerId: dto.ownerId ?? 'u1',
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(ws)
    return ws
  }
  async update(id: string, dto: any) {
    const ws = this.workspaces.find((w) => w.id === id)
    if (!ws) throw new Error('Not found')
    Object.assign(ws, dto, { updatedAt: new Date() })
    return ws
  }
  async delete(id: string) {
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestWorkspaceController {
  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly repo: IWorkspaceRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaces = await this.repo.findForUser('u1')
    ctx.json({ data: workspaces })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const ws = await this.repo.findById(ctx.params.id)
    if (!ws) return ctx.notFound('Workspace not found')
    ctx.json({ data: ws })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const ws = await this.repo.create(ctx.body)
    ctx.created({ data: ws })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WorkspaceController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(WORKSPACE_REPOSITORY, () => new InMemoryWorkspaceRepository())
        c.register(TestWorkspaceController, TestWorkspaceController)
      },
      routes: () => ({
        path: '/workspaces',
        router: buildRoutes(TestWorkspaceController),
        controller: TestWorkspaceController,
      }),
    })
  }

  it('GET /api/v1/workspaces returns workspace list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/workspaces').expect(200)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Acme Corp')
  })

  it('GET /api/v1/workspaces/:id returns a single workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/workspaces/ws1').expect(200)

    expect(res.body.data.slug).toBe('acme-corp')
  })

  it('GET /api/v1/workspaces/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/workspaces/unknown').expect(404)
  })

  it('POST /api/v1/workspaces creates a new workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .post('/api/v1/workspaces')
      .send({ name: 'New WS' })
      .expect(201)

    expect(res.body.data.name).toBe('New WS')
  })

  it('DELETE /api/v1/workspaces/:id removes the workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/workspaces/ws1').expect(204)
    await request(expressApp).get('/api/v1/workspaces/ws1').expect(404)
  })
})
