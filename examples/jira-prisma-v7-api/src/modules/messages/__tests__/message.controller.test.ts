import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
} from '../domain/repositories/message.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryMessageRepository implements IMessageRepository {
  private messages: any[] = [
    {
      id: 'm1',
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Hello world',
      mentions: [],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.messages.find((m) => m.id === id) ?? null
  }
  async findByChannel(channelId: string) {
    return this.messages.filter((m) => m.channelId === channelId)
  }
  async findPaginated(_parsed: any, channelId: string) {
    const filtered = this.messages.filter((m) => m.channelId === channelId)
    return { data: filtered, total: filtered.length }
  }
  async create(dto: any) {
    const msg = {
      id: `m${this.messages.length + 1}`,
      ...dto,
      mentions: dto.mentions ?? [],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.messages.push(msg)
    return msg
  }
  async update(id: string, dto: any) {
    const msg = this.messages.find((m) => m.id === id)
    if (!msg) throw new Error('Not found')
    Object.assign(msg, dto, { isEdited: true, updatedAt: new Date() })
    return msg
  }
  async delete(id: string) {
    this.messages = this.messages.filter((m) => m.id !== id)
  }
}

// ── Test controller ──────────────────────────────────────────────────

@Controller()
class TestMessageController {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  @Post('/')
  async create(ctx: RequestContext) {
    const result = await this.repo.create(ctx.body)
    ctx.created({ data: result })
  }

  @Get('/channel/:channelId')
  async listByChannel(ctx: RequestContext) {
    const messages = await this.repo.findByChannel(ctx.params.channelId)
    ctx.json({ data: messages })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MessageController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(MESSAGE_REPOSITORY, () => new InMemoryMessageRepository())
        c.register(TestMessageController, TestMessageController)
      },
      routes: () => ({
        path: '/messages',
        router: buildRoutes(TestMessageController),
        controller: TestMessageController,
      }),
    })
  }

  it('GET /api/v1/messages/channel/:channelId returns messages', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/messages/channel/ch1').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].content).toBe('Hello world')
  })

  it('GET /api/v1/messages/channel/:channelId returns empty for unknown channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/messages/channel/unknown').expect(200)
    expect(res.body.data).toHaveLength(0)
  })

  it('POST /api/v1/messages creates a message', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .post('/api/v1/messages')
      .send({ channelId: 'ch1', senderId: 'u1', content: 'New message' })
      .expect(201)

    expect(res.body.data.content).toBe('New message')
  })

  it('DELETE /api/v1/messages/:id removes the message', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).delete('/api/v1/messages/m1').expect(204)

    const res = await request(expressApp).get('/api/v1/messages/channel/ch1').expect(200)
    expect(res.body.data).toHaveLength(0)
  })
})
