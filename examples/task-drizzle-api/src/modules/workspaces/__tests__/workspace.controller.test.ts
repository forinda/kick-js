import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Delete, Inject } from '@forinda/kickjs'
import type { RequestContext, ParsedQuery } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  WORKSPACE_REPOSITORY,
  type IWorkspaceRepository,
  type Workspace,
  type NewWorkspace,
} from '../domain/repositories/workspace.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: Workspace[] = [
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
    {
      id: 'ws2',
      name: 'Beta Inc',
      slug: 'beta-inc',
      description: 'Second workspace',
      ownerId: 'u2',
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

  async findForUser(_userId: string) {
    return this.workspaces
  }

  async findPaginated(parsed: ParsedQuery) {
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: this.workspaces.slice(start, start + limit), total: this.workspaces.length }
  }

  async create(dto: NewWorkspace) {
    const workspace: Workspace = {
      id: `ws${this.workspaces.length + 1}`,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      ownerId: dto.ownerId,
      logoUrl: dto.logoUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(workspace)
    return workspace
  }

  async update(id: string, dto: Partial<NewWorkspace>) {
    const workspace = this.workspaces.find((w) => w.id === id)
    if (!workspace) throw new Error('Not found')
    Object.assign(workspace, dto, { updatedAt: new Date() })
    return workspace
  }

  async delete(id: string) {
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestWorkspaceController {
  constructor(
    @Inject(WORKSPACE_REPOSITORY) private readonly repo: IWorkspaceRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaces = await this.repo.findForUser('u1')
    ctx.json({ data: workspaces, total: workspaces.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const workspace = await this.repo.findById(ctx.params.id)
    if (!workspace) return ctx.notFound('Workspace not found')
    ctx.json({ data: workspace })
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

    expect(res.body.data).toHaveLength(2)
    expect(res.body.total).toBe(2)
    expect(res.body.data[0]).toHaveProperty('name', 'Acme Corp')
  })

  it('GET /api/v1/workspaces/:id returns a single workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/workspaces/ws1').expect(200)

    expect(res.body.data.name).toBe('Acme Corp')
    expect(res.body.data.slug).toBe('acme-corp')
  })

  it('GET /api/v1/workspaces/:id returns 404 for unknown workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/workspaces/unknown').expect(404)
  })

  it('DELETE /api/v1/workspaces/:id removes the workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/workspaces/ws1').expect(204)

    await request(expressApp).get('/api/v1/workspaces/ws1').expect(404)
  })

  it('DELETE then list shows reduced count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/workspaces/ws1').expect(204)

    const res = await request(expressApp).get('/api/v1/workspaces').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Beta Inc')
  })
})
