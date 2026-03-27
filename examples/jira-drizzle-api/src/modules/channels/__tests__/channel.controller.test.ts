import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext, ParsedQuery } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  CHANNEL_REPOSITORY,
  type IChannelRepository,
  type Channel,
  type NewChannel,
} from '../domain/repositories/channel.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryChannelRepository implements IChannelRepository {
  private channels: Channel[] = [
    {
      id: 'ch1',
      workspaceId: 'ws1',
      projectId: null,
      name: 'general',
      description: null,
      type: 'public',
      createdById: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'ch2',
      workspaceId: 'ws1',
      projectId: 'p1',
      name: 'dev',
      description: 'Development chat',
      type: 'private',
      createdById: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.channels.find((c) => c.id === id) ?? null
  }

  async findPaginated(parsed: ParsedQuery, workspaceId: string) {
    const filtered = this.channels.filter((c) => c.workspaceId === workspaceId)
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: filtered.slice(start, start + limit), total: filtered.length }
  }

  async create(data: NewChannel) {
    const channel: Channel = {
      id: `ch${this.channels.length + 1}`,
      workspaceId: data.workspaceId,
      projectId: data.projectId ?? null,
      name: data.name,
      description: data.description ?? null,
      type: data.type ?? 'public',
      createdById: data.createdById,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.channels.push(channel)
    return channel
  }

  async update(id: string, data: Partial<NewChannel>) {
    const channel = this.channels.find((c) => c.id === id)
    if (!channel) throw new Error('Not found')
    Object.assign(channel, data, { updatedAt: new Date() })
    return channel
  }

  async delete(id: string) {
    this.channels = this.channels.filter((c) => c.id !== id)
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestChannelController {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly repo: IChannelRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as ParsedQuery, 'ws1')
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const channel = await this.repo.findById(ctx.params.id)
    if (!channel) return ctx.notFound('Channel not found')
    ctx.json({ data: channel })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ChannelController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(CHANNEL_REPOSITORY, () => new InMemoryChannelRepository())
        c.register(TestChannelController, TestChannelController)
      },
      routes: () => ({
        path: '/channels',
        router: buildRoutes(TestChannelController),
        controller: TestChannelController,
      }),
    })
  }

  it('GET /api/v1/channels returns channel list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/channels').expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.total).toBe(2)
    expect(res.body.data[0]).toHaveProperty('name', 'general')
  })

  it('GET /api/v1/channels/:id returns a single channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/channels/ch1').expect(200)

    expect(res.body.data.name).toBe('general')
    expect(res.body.data.type).toBe('public')
  })

  it('GET /api/v1/channels/:id returns 404 for unknown channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/channels/unknown').expect(404)
  })

  it('DELETE /api/v1/channels/:id removes the channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/channels/ch1').expect(204)

    await request(expressApp).get('/api/v1/channels/ch1').expect(404)
  })

  it('DELETE then list shows reduced count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/channels/ch1').expect(204)

    const res = await request(expressApp).get('/api/v1/channels').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('dev')
  })
})
