import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs-core'
import { createTestApp } from '@forinda/kickjs-testing'
import { HealthModule } from './modules/healths'

describe('Microservice API — HealthController', () => {
  beforeEach(() => Container.reset())

  it('GET /api/v1/healths returns a paginated response', async () => {
    const { expressApp } = await createTestApp({ modules: [HealthModule] })

    const res = await request(expressApp).get('/api/v1/healths').expect(200)

    expect(res.body).toHaveProperty('data')
    expect(res.body).toHaveProperty('meta')
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('POST /api/v1/healths creates a health record', async () => {
    const { expressApp } = await createTestApp({ modules: [HealthModule] })

    const res = await request(expressApp)
      .post('/api/v1/healths')
      .send({ name: 'CPU Check' })
      .expect(201)

    expect(res.body).toHaveProperty('id')
    expect(res.body).toHaveProperty('name', 'CPU Check')
  })

  it('GET /api/v1/healths/:id returns a created health record', async () => {
    const { expressApp } = await createTestApp({ modules: [HealthModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/healths')
      .send({ name: 'Memory Check' })
      .expect(201)

    const id = createRes.body.id

    const res = await request(expressApp).get(`/api/v1/healths/${id}`).expect(200)

    expect(res.body).toHaveProperty('id', id)
    expect(res.body).toHaveProperty('name', 'Memory Check')
  })

  it('GET /api/v1/healths/:id returns 404 for non-existent record', async () => {
    const { expressApp } = await createTestApp({ modules: [HealthModule] })

    await request(expressApp).get('/api/v1/healths/non-existent-id').expect(404)
  })

  it('DELETE /api/v1/healths/:id removes the health record', async () => {
    const { expressApp } = await createTestApp({ modules: [HealthModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/healths')
      .send({ name: 'Disk Check' })
      .expect(201)

    const id = createRes.body.id

    await request(expressApp).delete(`/api/v1/healths/${id}`).expect(204)

    await request(expressApp).get(`/api/v1/healths/${id}`).expect(404)
  })
})
