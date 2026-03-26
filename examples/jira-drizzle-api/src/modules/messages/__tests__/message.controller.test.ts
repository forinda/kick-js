import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Put, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext, ParsedQuery } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
  type Message,
  type NewMessage,
} from '../domain/repositories/message.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryMessageRepository implements IMessageRepository {
  private messages: Message[] = [
    {
      id: 'm1',
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Hello everyone',
      mentions: [],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm2',
      channelId: 'ch1',
      senderId: 'u2',
      content: 'Hi there',
      mentions: ['u1'],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm3',
      channelId: 'ch2',
      senderId: 'u1',
      content: 'Different channel',
      mentions: [],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.messages.find((m) => m.id === id) ?? null
  }

  async findByChannel(channelId: string, cursor?: string, limit?: number) {
    let filtered = this.messages.filter((m) => m.channelId === channelId)
    if (cursor) {
      const idx = filtered.findIndex((m) => m.id === cursor)
      if (idx >= 0) filtered = filtered.slice(idx + 1)
    }
    if (limit) filtered = filtered.slice(0, limit)
    return filtered
  }

  async findPaginated(parsed: ParsedQuery, channelId: string) {
    const filtered = this.messages.filter((m) => m.channelId === channelId)
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: filtered.slice(start, start + limit), total: filtered.length }
  }

  async create(dto: NewMessage) {
    const message: Message = {
      id: `m${this.messages.length + 1}`,
      channelId: dto.channelId,
      senderId: dto.senderId,
      content: dto.content,
      mentions: dto.mentions ?? [],
      isEdited: dto.isEdited ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async update(id: string, dto: Partial<NewMessage>) {
    const message = this.messages.find((m) => m.id === id)
    if (!message) throw new Error('Not found')
    Object.assign(message, dto, { updatedAt: new Date() })
    return message
  }

  async delete(id: string) {
    this.messages = this.messages.filter((m) => m.id !== id)
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestMessageController {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly repo: IMessageRepository,
  ) {}

  @Get('/channel/:channelId')
  async listByChannel(ctx: RequestContext) {
    const messages = await this.repo.findByChannel(
      ctx.params.channelId,
      ctx.query.cursor as string | undefined,
      ctx.query.limit ? Number(ctx.query.limit) : undefined,
    )
    ctx.json({ data: messages })
  }

  @Put('/:id')
  async update(ctx: RequestContext) {
    const result = await this.repo.update(ctx.params.id, ctx.body)
    ctx.json({ data: result })
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
    expect(res.body.data[0]).toHaveProperty('content', 'Hello everyone')
  })

  it('GET /api/v1/messages/channel/:channelId returns empty for unknown channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/messages/channel/unknown').expect(200)

    expect(res.body.data).toHaveLength(0)
  })

  it('PUT /api/v1/messages/:id updates a message', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .put('/api/v1/messages/m1')
      .send({ content: 'Updated content' })
      .expect(200)

    expect(res.body.data.content).toBe('Updated content')
  })

  it('DELETE /api/v1/messages/:id removes the message', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/messages/m1').expect(204)

    // Verify message is gone from channel listing
    const res = await request(expressApp).get('/api/v1/messages/channel/ch1').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].content).toBe('Hi there')
  })
})
