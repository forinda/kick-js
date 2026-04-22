import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  PROJECT_REPOSITORY,
  type IProjectRepository,
} from '../domain/repositories/project.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryProjectRepository implements IProjectRepository {
  private projects: any[] = [
    {
      id: 'p1',
      workspaceId: 'w1',
      name: 'Alpha',
      key: 'ALP',
      description: null,
      leadId: null,
      taskCounter: 0,
      isArchived: false,
      statusColumns: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.projects.find((p) => p.id === id) ?? null
  }
  async findByWorkspace(workspaceId: string) {
    return this.projects.filter((p) => p.workspaceId === workspaceId)
  }
  async findPaginated() {
    return { data: this.projects, total: this.projects.length }
  }
  async create(dto: any) {
    const project = {
      id: `p${this.projects.length + 1}`,
      ...dto,
      description: dto.description ?? null,
      leadId: dto.leadId ?? null,
      taskCounter: 0,
      isArchived: false,
      statusColumns: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.projects.push(project)
    return project
  }
  async update(id: string, dto: any) {
    const project = this.projects.find((p) => p.id === id)
    if (!project) throw new Error('Not found')
    Object.assign(project, dto, { updatedAt: new Date() })
    return project
  }
  async incrementTaskCounter(id: string) {
    const project = this.projects.find((p) => p.id === id)
    if (!project) throw new Error('Not found')
    project.taskCounter += 1
    return { taskCounter: project.taskCounter, key: project.key }
  }
  async delete(id: string) {
    this.projects = this.projects.filter((p) => p.id !== id)
  }
}

// ── Test controller ──────────────────────────────────────────────────

@Controller()
class TestProjectController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: IProjectRepository,
  ) {}

  @Post('/')
  async create(ctx: RequestContext) {
    const result = await this.repo.create(ctx.body)
    ctx.created({ data: result })
  }

  @Get('/')
  async list(ctx: RequestContext) {
    const projects = await this.repo.findPaginated({} as any)
    ctx.json(projects)
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.repo.findById(ctx.params.id)
    if (!result) return ctx.notFound('Project not found')
    ctx.json({ data: result })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProjectController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(PROJECT_REPOSITORY, () => new InMemoryProjectRepository())
        c.register(TestProjectController, TestProjectController)
      },
      routes: () => ({
        path: '/projects',
        router: buildRoutes(TestProjectController),
        controller: TestProjectController,
      }),
    })
  }

  it('GET /api/v1/projects returns project list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/projects').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Alpha')
  })

  it('GET /api/v1/projects/:id returns a single project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/projects/p1').expect(200)
    expect(res.body.data.name).toBe('Alpha')
    expect(res.body.data.key).toBe('ALP')
  })

  it('GET /api/v1/projects/:id returns 404 for unknown project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).get('/api/v1/projects/unknown').expect(404)
  })

  it('POST /api/v1/projects creates a project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .post('/api/v1/projects')
      .send({ workspaceId: 'w1', name: 'Beta', key: 'BET' })
      .expect(201)

    expect(res.body.data.name).toBe('Beta')
    expect(res.body.data.key).toBe('BET')
  })

  it('DELETE /api/v1/projects/:id removes the project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).delete('/api/v1/projects/p1').expect(204)
    await request(expressApp).get('/api/v1/projects/p1').expect(404)
  })
})
