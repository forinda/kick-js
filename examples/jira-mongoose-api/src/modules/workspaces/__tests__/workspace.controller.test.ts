import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import type { IWorkspaceRepository } from '../domain/repositories/workspace.repository'
import type { WorkspaceEntity } from '../domain/entities/workspace.entity'
import type { Types } from 'mongoose'
import { TOKENS } from '@/shared/constants/tokens'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: WorkspaceEntity[] = [
    {
      _id: 'ws1' as unknown as Types.ObjectId,
      name: 'Acme Corp',
      slug: 'acme-corp',
      ownerId: 'owner1' as unknown as Types.ObjectId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 'ws2' as unknown as Types.ObjectId,
      name: 'Test Inc',
      slug: 'test-inc',
      ownerId: 'owner2' as unknown as Types.ObjectId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.workspaces.find((w) => String(w._id) === id) ?? null
  }

  async findBySlug(slug: string) {
    return this.workspaces.find((w) => w.slug === slug) ?? null
  }

  async create(data: Partial<WorkspaceEntity>) {
    const ws: WorkspaceEntity = {
      _id: `ws${this.workspaces.length + 1}` as unknown as Types.ObjectId,
      name: data.name!,
      slug: data.slug!,
      ownerId: data.ownerId!,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(ws)
    return ws
  }

  async update(id: string, data: Partial<WorkspaceEntity>) {
    const ws = this.workspaces.find((w) => String(w._id) === id)
    if (!ws) return null
    Object.assign(ws, data, { updatedAt: new Date() })
    return ws
  }

  async delete(id: string) {
    const len = this.workspaces.length
    this.workspaces = this.workspaces.filter((w) => String(w._id) !== id)
    return this.workspaces.length < len
  }

  async findByOwner(ownerId: string) {
    return this.workspaces.filter((w) => String(w.ownerId) === ownerId)
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestWorkspaceController {
  constructor(
    @Inject(TOKENS.WORKSPACE_REPOSITORY) private readonly repo: IWorkspaceRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaces = await this.repo.findByOwner('owner1')
    ctx.json({ data: workspaces, total: workspaces.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const ws = await this.repo.findById(ctx.params.id)
    if (!ws) return ctx.notFound('Workspace not found')
    ctx.json({ data: ws })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.repo.delete(ctx.params.id)
    if (!deleted) return ctx.notFound('Workspace not found')
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WorkspaceController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(TOKENS.WORKSPACE_REPOSITORY, () => new InMemoryWorkspaceRepository())
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

    // Verify workspace is gone
    await request(expressApp).get('/api/v1/workspaces/ws1').expect(404)
  })
})
