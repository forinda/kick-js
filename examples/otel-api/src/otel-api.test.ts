import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs-core'
import { createTestApp } from '@forinda/kickjs-testing'
import { TaskModule } from './modules/tasks'

describe('OTel API — TaskController', () => {
  beforeEach(() => Container.reset())

  it('GET /api/v1/tasks returns a paginated response', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const res = await request(expressApp).get('/api/v1/tasks').expect(200)

    expect(res.body).toHaveProperty('data')
    expect(res.body).toHaveProperty('meta')
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('POST /api/v1/tasks creates a task', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const res = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ name: 'Deploy service' })
      .expect(201)

    expect(res.body).toHaveProperty('id')
    expect(res.body).toHaveProperty('name', 'Deploy service')
  })

  it('GET /api/v1/tasks/:id returns a created task', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ name: 'Monitor traces' })
      .expect(201)

    const id = createRes.body.id

    const res = await request(expressApp).get(`/api/v1/tasks/${id}`).expect(200)

    expect(res.body).toHaveProperty('id', id)
    expect(res.body).toHaveProperty('name', 'Monitor traces')
  })

  it('GET /api/v1/tasks/:id returns 404 for non-existent task', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    await request(expressApp).get('/api/v1/tasks/non-existent-id').expect(404)
  })

  it('DELETE /api/v1/tasks/:id removes the task', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ name: 'Temporary' })
      .expect(201)

    const id = createRes.body.id

    await request(expressApp).delete(`/api/v1/tasks/${id}`).expect(204)

    await request(expressApp).get(`/api/v1/tasks/${id}`).expect(404)
  })
})
