import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../domain/repositories/comment.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryCommentRepository implements ICommentRepository {
  private comments: any[] = [
    {
      id: 'c1',
      taskId: 't1',
      authorId: 'u1',
      content: 'First comment',
      mentions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.comments.find((c) => c.id === id) ?? null
  }
  async findByTask(taskId: string) {
    return this.comments.filter((c) => c.taskId === taskId)
  }
  async findPaginated() {
    return { data: this.comments, total: this.comments.length }
  }
  async create(dto: any) {
    const comment = {
      id: `c${this.comments.length + 1}`,
      ...dto,
      mentions: dto.mentions ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.comments.push(comment)
    return comment
  }
  async update(id: string, dto: any) {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) throw new Error('Not found')
    Object.assign(comment, dto, { updatedAt: new Date() })
    return comment
  }
  async delete(id: string) {
    this.comments = this.comments.filter((c) => c.id !== id)
  }
  async countByTask(taskId: string) {
    return this.comments.filter((c) => c.taskId === taskId).length
  }
}

// ── Test controller ──────────────────────────────────────────────────

@Controller()
class TestCommentController {
  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository,
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
    if (!result) return ctx.notFound('Comment not found')
    ctx.json({ data: result })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('CommentController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(COMMENT_REPOSITORY, () => new InMemoryCommentRepository())
        c.register(TestCommentController, TestCommentController)
      },
      routes: () => ({
        path: '/comments',
        router: buildRoutes(TestCommentController),
        controller: TestCommentController,
      }),
    })
  }

  it('GET /api/v1/comments returns comment list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/comments').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].content).toBe('First comment')
  })

  it('GET /api/v1/comments/:id returns a single comment', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/comments/c1').expect(200)
    expect(res.body.data.content).toBe('First comment')
  })

  it('GET /api/v1/comments/:id returns 404 for unknown comment', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).get('/api/v1/comments/unknown').expect(404)
  })

  it('POST /api/v1/comments creates a comment', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .post('/api/v1/comments')
      .send({ taskId: 't1', authorId: 'u1', content: 'New comment' })
      .expect(201)

    expect(res.body.data.content).toBe('New comment')
  })

  it('DELETE /api/v1/comments/:id removes the comment', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).delete('/api/v1/comments/c1').expect(204)
    await request(expressApp).get('/api/v1/comments/c1').expect(404)
  })
})
