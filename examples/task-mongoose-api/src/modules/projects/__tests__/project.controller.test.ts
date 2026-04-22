import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Delete, Inject } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import type { IProjectRepository } from '../domain/repositories/project.repository'
import type { ProjectEntity } from '../domain/entities/project.entity'
import type { Types } from 'mongoose'
import { TOKENS } from '@/shared/constants/tokens'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryProjectRepository implements IProjectRepository {
  private projects: ProjectEntity[] = [
    {
      _id: 'p1' as unknown as Types.ObjectId,
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'Project Alpha',
      key: 'PA',
      statusColumns: [{ name: 'To Do', order: 0, color: '#ccc' }],
      taskCounter: 5,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 'p2' as unknown as Types.ObjectId,
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'Project Beta',
      key: 'PB',
      statusColumns: [{ name: 'To Do', order: 0, color: '#ccc' }],
      taskCounter: 0,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.projects.find((p) => String(p._id) === id) ?? null
  }

  async findByWorkspace(workspaceId: string) {
    return this.projects.filter((p) => String(p.workspaceId) === workspaceId)
  }

  async findByKeyAndWorkspace(key: string, workspaceId: string) {
    return (
      this.projects.find(
        (p) => p.key === key && String(p.workspaceId) === workspaceId,
      ) ?? null
    )
  }

  async create(data: Partial<ProjectEntity>) {
    const project: ProjectEntity = {
      _id: `p${this.projects.length + 1}` as unknown as Types.ObjectId,
      workspaceId: data.workspaceId!,
      name: data.name!,
      key: data.key!,
      statusColumns: data.statusColumns ?? [],
      taskCounter: 0,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.projects.push(project)
    return project
  }

  async update(id: string, data: Partial<ProjectEntity>) {
    const project = this.projects.find((p) => String(p._id) === id)
    if (!project) return null
    Object.assign(project, data, { updatedAt: new Date() })
    return project
  }

  async delete(id: string) {
    const len = this.projects.length
    this.projects = this.projects.filter((p) => String(p._id) !== id)
    return this.projects.length < len
  }

  async incrementTaskCounter(projectId: string) {
    const project = this.projects.find((p) => String(p._id) === projectId)
    if (!project) throw new Error('Not found')
    project.taskCounter++
    return project.taskCounter
  }
}

// ── Test controller (no auth/guard middleware) ────────────────────────

@Controller()
class TestProjectController {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY) private readonly repo: IProjectRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const projects = await this.repo.findByWorkspace('ws1')
    ctx.json({ data: projects, total: projects.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const project = await this.repo.findById(ctx.params.id)
    if (!project) return ctx.notFound('Project not found')
    ctx.json({ data: project })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.repo.delete(ctx.params.id)
    if (!deleted) return ctx.notFound('Project not found')
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProjectController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(TOKENS.PROJECT_REPOSITORY, () => new InMemoryProjectRepository())
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

    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0]).toHaveProperty('name', 'Project Alpha')
  })

  it('GET /api/v1/projects/:id returns a single project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/projects/p1').expect(200)

    expect(res.body.data.name).toBe('Project Alpha')
    expect(res.body.data.key).toBe('PA')
  })

  it('GET /api/v1/projects/:id returns 404 for unknown project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/projects/unknown').expect(404)
  })

  it('DELETE /api/v1/projects/:id removes the project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/projects/p1').expect(204)

    await request(expressApp).get('/api/v1/projects/p1').expect(404)
  })
})
