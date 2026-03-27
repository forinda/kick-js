import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
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
      workspaceId: 'ws1',
      name: 'Alpha',
      key: 'ALPHA',
      description: null,
      leadId: null,
      taskCounter: 0,
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
      workspaceId: dto.workspaceId,
      name: dto.name,
      key: dto.key,
      description: dto.description ?? null,
      leadId: dto.leadId ?? null,
      taskCounter: 0,
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

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestProjectController {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: IProjectRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await repo.findPaginated({} as any)
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/workspace/:workspaceId')
  async listByWorkspace(ctx: RequestContext) {
    const projects = await this.repo.findByWorkspace(ctx.params.workspaceId)
    ctx.json({ data: projects })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const project = await this.repo.findById(ctx.params.id)
    if (!project) return ctx.notFound('Project not found')
    ctx.json({ data: project })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const project = await this.repo.create(ctx.body)
    ctx.created({ data: project })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

let repo: InMemoryProjectRepository

// ── Tests ────────────────────────────────────────────────────────────

describe('ProjectController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    repo = new InMemoryProjectRepository()
    return createTestModule({
      register: (c) => {
        c.registerFactory(PROJECT_REPOSITORY, () => repo)
        c.register(TestProjectController, TestProjectController)
      },
      routes: () => ({
        path: '/projects',
        router: buildRoutes(TestProjectController),
        controller: TestProjectController,
      }),
    })
  }

  it('GET /api/v1/projects/:id returns a single project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/projects/p1').expect(200)

    expect(res.body.data.name).toBe('Alpha')
    expect(res.body.data.key).toBe('ALPHA')
  })

  it('GET /api/v1/projects/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/projects/unknown').expect(404)
  })

  it('POST /api/v1/projects creates a new project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .post('/api/v1/projects')
      .send({ workspaceId: 'ws1', name: 'Beta', key: 'BETA' })
      .expect(201)

    expect(res.body.data.name).toBe('Beta')
  })

  it('DELETE /api/v1/projects/:id removes the project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/projects/p1').expect(204)
    await request(expressApp).get('/api/v1/projects/p1').expect(404)
  })
})
