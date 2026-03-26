import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  LABEL_REPOSITORY,
  type ILabelRepository,
} from '../domain/repositories/label.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryLabelRepository implements ILabelRepository {
  private labels: any[] = [
    {
      id: 'l1',
      workspaceId: 'w1',
      name: 'Bug',
      color: '#ff0000',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.labels.find((l) => l.id === id) ?? null
  }
  async findByWorkspace(workspaceId: string) {
    return this.labels.filter((l) => l.workspaceId === workspaceId)
  }
  async findPaginated() {
    return { data: this.labels, total: this.labels.length }
  }
  async create(dto: any) {
    const label = {
      id: `l${this.labels.length + 1}`,
      ...dto,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.labels.push(label)
    return label
  }
  async update(id: string, dto: any) {
    const label = this.labels.find((l) => l.id === id)
    if (!label) throw new Error('Not found')
    Object.assign(label, dto, { updatedAt: new Date() })
    return label
  }
  async delete(id: string) {
    this.labels = this.labels.filter((l) => l.id !== id)
  }
}

// ── Test controller ──────────────────────────────────────────────────

@Controller()
class TestLabelController {
  constructor(
    @Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository,
  ) {}

  @Post('/')
  async create(ctx: RequestContext) {
    const result = await this.repo.create(ctx.body)
    ctx.created({ data: result })
  }

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as any)
    ctx.json(result)
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.repo.findById(ctx.params.id)
    if (!result) return ctx.notFound('Label not found')
    ctx.json({ data: result })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('LabelController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(LABEL_REPOSITORY, () => new InMemoryLabelRepository())
        c.register(TestLabelController, TestLabelController)
      },
      routes: () => ({
        path: '/labels',
        router: buildRoutes(TestLabelController),
        controller: TestLabelController,
      }),
    })
  }

  it('GET /api/v1/labels returns label list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/labels').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Bug')
  })

  it('GET /api/v1/labels/:id returns a single label', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/labels/l1').expect(200)
    expect(res.body.data.name).toBe('Bug')
    expect(res.body.data.color).toBe('#ff0000')
  })

  it('GET /api/v1/labels/:id returns 404 for unknown label', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).get('/api/v1/labels/unknown').expect(404)
  })

  it('POST /api/v1/labels creates a label', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .post('/api/v1/labels')
      .send({ workspaceId: 'w1', name: 'Feature', color: '#00ff00' })
      .expect(201)

    expect(res.body.data.name).toBe('Feature')
  })

  it('DELETE /api/v1/labels/:id removes the label', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).delete('/api/v1/labels/l1').expect(204)
    await request(expressApp).get('/api/v1/labels/l1').expect(404)
  })
})
