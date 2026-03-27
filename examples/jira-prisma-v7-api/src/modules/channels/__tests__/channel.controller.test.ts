import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
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
      workspaceId: 'w1',
      projectId: null,
      name: 'general',
      description: null,
      type: 'public',
      createdById: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.channels.find((c) => c.id === id) ?? null
  }
  async findPaginated(_parsed: any, workspaceId: string) {
    const filtered = this.channels.filter((c) => c.workspaceId === workspaceId)
    return { data: filtered, total: filtered.length }
  }
  async create(dto: any) {
    const channel = {
      id: `ch${this.channels.length + 1}`,
      ...dto,
      description: dto.description ?? null,
      type: dto.type ?? 'public',
      projectId: dto.projectId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.channels.push(channel)
    return channel
  }
  async update(id: string, dto: any) {
    const channel = this.channels.find((c) => c.id === id)
    if (!channel) throw new Error('Not found')
    Object.assign(channel, dto, { updatedAt: new Date() })
    return channel
  }
  async delete(id: string) {
    this.channels = this.channels.filter((c) => c.id !== id)
  }
}

// ── Test controller ──────────────────────────────────────────────────

@Controller()
class TestChannelController {
  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly repo: IChannelRepository,
  ) {}

  @Post('/')
  async create(ctx: RequestContext) {
    const result = await this.repo.create(ctx.body)
    ctx.created({ data: result })
  }

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as any, 'w1')
    ctx.json(result)
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.repo.findById(ctx.params.id)
    if (!result) return ctx.notFound('Channel not found')
    ctx.json({ data: result })
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

  it('GET /api/v1/channels/:id returns 404 for unknown channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).get('/api/v1/channels/unknown').expect(404)
  })

  it('POST /api/v1/channels creates a channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .post('/api/v1/channels')
      .send({ workspaceId: 'w1', name: 'dev', createdById: 'u1' })
      .expect(201)

    expect(res.body.data.name).toBe('dev')
  })

  it('DELETE /api/v1/channels/:id removes the channel', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).delete('/api/v1/channels/ch1').expect(204)
    await request(expressApp).get('/api/v1/channels/ch1').expect(404)
  })
})
