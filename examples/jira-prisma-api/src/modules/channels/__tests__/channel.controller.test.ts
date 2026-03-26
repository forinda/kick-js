import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  CHANNEL_REPOSITORY,
  type IChannelRepository,
} from '../domain/repositories/channel.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryChannelRepository implements IChannelRepository {
  private channels: any[] = [
    {
      id: 'ch1',
      workspaceId: 'ws1',
      name: 'general',
      description: null,
      type: 'public',
      createdById: 'u1',
      projectId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.channels.find((c) => c.id === id) ?? null
  }
  async findPaginated() {
    return { data: this.channels, total: this.channels.length }
  }
  async create(data: any) {
    const channel = {
      id: `ch${this.channels.length + 1}`,
      ...data,
      type: data.type ?? 'public',
      description: data.description ?? null,
      projectId: data.projectId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.channels.push(channel)
    return channel
  }
  async update(id: string, data: any) {
    const channel = this.channels.find((c) => c.id === id)
    if (!channel) throw new Error('Not found')
    Object.assign(channel, data, { updatedAt: new Date() })
    return channel
  }
  async delete(id: string) {
    this.channels = this.channels.filter((c) => c.id !== id)
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestChannelController {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly repo: IChannelRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as any, 'ws1')
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const channel = await this.repo.findById(ctx.params.id)
    if (!channel) return ctx.notFound('Channel not found')
    ctx.json({ data: channel })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const channel = await this.repo.create(ctx.body)
    ctx.created({ data: channel })
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

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('general')
  })

  it('GET /api/v1/channels/:id returns a single channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/channels/ch1').expect(200)

    expect(res.body.data.name).toBe('general')
  })

  it('GET /api/v1/channels/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/channels/unknown').expect(404)
  })

  it('POST /api/v1/channels creates a new channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .post('/api/v1/channels')
      .send({ workspaceId: 'ws1', name: 'dev', createdById: 'u1' })
      .expect(201)

    expect(res.body.data.name).toBe('dev')
  })

  it('DELETE /api/v1/channels/:id removes the channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/channels/ch1').expect(204)
    await request(expressApp).get('/api/v1/channels/ch1').expect(404)
  })
})
