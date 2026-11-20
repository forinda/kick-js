/**
 * Real containers — opt in with KICK_TEST_CONTAINERS=1 (needs Docker). Pulling
 * images is slow, so CI's default run skips these.
 */
import 'reflect-metadata'
import { createConnection } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { z } from 'zod'
import {
  Controller,
  Get,
  Inject,
  Service,
  defineSettings,
  type RequestContext,
  type SettingsOf,
} from '@forinda/kickjs'
import { createTestApp, startService, type StartedService } from '../src/index'
import request from 'supertest'

const enabled = process.env.KICK_TEST_CONTAINERS === '1'

const DbSettings = defineSettings('KTC_DB', z.object({ url: z.string() }))

describe.skipIf(!enabled)('startService', () => {
  let postgres: StartedService
  let redis: StartedService
  beforeAll(async () => {
    ;[postgres, redis] = await Promise.all([startService('postgres'), startService('redis')])
  }, 180_000)
  afterAll(async () => {
    await Promise.all([postgres?.stop(), redis?.stop()])
  })

  it('gives the app a real Postgres through a provided settings section', async () => {
    @Service()
    class Db {
      constructor(@Inject(DbSettings) private readonly settings: SettingsOf<typeof DbSettings>) {}
      async now(): Promise<number> {
        const client = new pg.Client({ connectionString: this.settings.url })
        await client.connect()
        try {
          const { rows } = await client.query('select 41 + 1 as answer')
          return rows[0].answer
        } finally {
          await client.end()
        }
      }
    }
    @Controller()
    class C {
      constructor(@Inject(Db) private readonly db: Db) {}
      @Get('/')
      async get(ctx: RequestContext) {
        ctx.json({ answer: await this.db.now() })
      }
    }

    const { app } = await createTestApp({
      modules: [{ routes: () => ({ path: '/db', controller: C }) } as never],
      settings: [DbSettings.provide({ url: postgres.url })],
    })
    const res = await request(app.handle.bind(app)).get('/api/v1/db').expect(200)
    expect(res.body).toEqual({ answer: 42 })
    expect(postgres.url).toMatch(/^postgres:\/\/test:test@.+:\d+\/test$/)
  })

  it('starts MinIO', async () => {
    const minio = await startService('minio')
    try {
      // The bucket itself is checked by kickjs-storage's live tests.
      expect((await fetch(`${minio.url}/minio/health/ready`)).status).toBe(200)
    } finally {
      await minio.stop()
    }
  }, 120_000)

  it('starts Redis', async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: redis.host, port: redis.port }, () =>
        socket.write('PING\r\n'),
      )
      socket.once('data', (data) => {
        resolve(data.toString())
        socket.end()
      })
      socket.once('error', reject)
    })
    expect(reply.trim()).toBe('+PONG')
    expect(redis.url).toBe(`redis://${redis.host}:${redis.port}`)
  })
})

describe.skipIf(!enabled)('startService — named and reused', () => {
  const name = `kick-testing-reuse-${process.pid}`
  const query = async (url: string) => {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      return (await client.query('select 1 as one')).rows[0].one
    } finally {
      await client.end()
    }
  }
  afterAll(async () => {
    const { execFileSync } = await import('node:child_process')
    execFileSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' })
  })

  it('attaches the second time, and after the container was stopped', async () => {
    const first = await startService('postgres', { name, reuse: true })
    expect(await query(first.url)).toBe(1)
    const second = await startService('postgres', { name, reuse: true })
    expect(second.reused).toBe(true)
    expect(second.port).toBe(first.port)
    const { execFileSync } = await import('node:child_process')
    execFileSync('docker', ['stop', name], { stdio: 'ignore' })
    const third = await startService('postgres', { name, reuse: true })
    expect(await query(third.url)).toBe(1)
  }, 180_000)
})
