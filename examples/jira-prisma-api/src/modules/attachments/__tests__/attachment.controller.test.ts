import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../domain/repositories/attachment.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryAttachmentRepository implements IAttachmentRepository {
  private attachments: any[] = [
    {
      id: 'a1',
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'screenshot.png',
      fileSize: 1024,
      mimeType: 'image/png',
      data: 'base64data',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.attachments.find((a) => a.id === id) ?? null
  }
  async findByTask(taskId: string) {
    return this.attachments.filter((a) => a.taskId === taskId)
  }
  async findPaginated() {
    return { data: this.attachments, total: this.attachments.length }
  }
  async create(data: any) {
    const attachment = {
      id: `a${this.attachments.length + 1}`,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.attachments.push(attachment)
    return attachment
  }
  async delete(id: string) {
    this.attachments = this.attachments.filter((a) => a.id !== id)
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestAttachmentController {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as any)
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const attachment = await this.repo.findById(ctx.params.id)
    if (!attachment) return ctx.notFound('Attachment not found')
    ctx.json({ data: attachment })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AttachmentController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(ATTACHMENT_REPOSITORY, () => new InMemoryAttachmentRepository())
        c.register(TestAttachmentController, TestAttachmentController)
      },
      routes: () => ({
        path: '/attachments',
        router: buildRoutes(TestAttachmentController),
        controller: TestAttachmentController,
      }),
    })
  }

  it('GET /api/v1/attachments returns attachment list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/attachments').expect(200)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].fileName).toBe('screenshot.png')
  })

  it('GET /api/v1/attachments/:id returns a single attachment', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/attachments/a1').expect(200)

    expect(res.body.data.fileName).toBe('screenshot.png')
    expect(res.body.data.mimeType).toBe('image/png')
  })

  it('GET /api/v1/attachments/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/attachments/unknown').expect(404)
  })

  it('DELETE /api/v1/attachments/:id removes the attachment', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/attachments/a1').expect(204)
    await request(expressApp).get('/api/v1/attachments/a1').expect(404)
  })
})
