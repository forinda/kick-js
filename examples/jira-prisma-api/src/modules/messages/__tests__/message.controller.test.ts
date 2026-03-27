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
      mentions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm2',
      channelId: 'ch1',
      senderId: 'u2',
      content: 'Hi there',
      mentions: null,
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
  async findPaginated() {
    return { data: this.messages, total: this.messages.length }
  }
  async create(data: any) {
    const message = {
      id: `m${this.messages.length + 1}`,
      ...data,
      mentions: data.mentions ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.messages.push(message)
    return message
  }
  async update(id: string, data: any) {
    const message = this.messages.find((m) => m.id === id)
    if (!message) throw new Error('Not found')
    Object.assign(message, data, { updatedAt: new Date() })
    return message
  }
  async delete(id: string) {
    this.messages = this.messages.filter((m) => m.id !== id)
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestMessageController {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  @Get('/channel/:channelId')
  async listByChannel(ctx: RequestContext) {
    const messages = await this.repo.findByChannel(ctx.params.channelId)
    ctx.json({ data: messages })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const message = await this.repo.findById(ctx.params.id)
    if (!message) return ctx.notFound('Message not found')
    ctx.json({ data: message })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const message = await this.repo.create(ctx.body)
    ctx.created({ data: message })
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

  it('GET /api/v1/messages/channel/:channelId returns messages for a channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/messages/channel/ch1').expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].content).toBe('Hello world')
  })

  it('GET /api/v1/messages/:id returns a single message', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/messages/m1').expect(200)

    expect(res.body.data.content).toBe('Hello world')
  })

  it('GET /api/v1/messages/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/messages/unknown').expect(404)
  })

  it('POST /api/v1/messages creates a new message', async () => {
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
    await request(expressApp).get('/api/v1/messages/m1').expect(404)
  })
})
