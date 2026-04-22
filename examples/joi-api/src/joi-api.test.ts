import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'
import { TaskModule } from './modules/tasks'

describe('Joi API — TaskController', () => {
  beforeEach(() => Container.reset())

  it('GET /api/v1/tasks returns an empty list initially', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const res = await request(expressApp).get('/api/v1/tasks').expect(200)

    expect(res.body).toEqual([])
  })

  it('POST /api/v1/tasks creates a task with Joi validation', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const res = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ title: 'Write tests', priority: 'high', status: 'todo' })
      .expect(201)

    expect(res.body).toHaveProperty('id')
    expect(res.body).toHaveProperty('title', 'Write tests')
    expect(res.body).toHaveProperty('priority', 'high')
    expect(res.body).toHaveProperty('status', 'todo')
  })

  it('POST /api/v1/tasks returns 422 for invalid body', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const res = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ priority: 'invalid_value' })
      .expect(422)

    expect(res.body).toHaveProperty('message')
  })

  it('GET /api/v1/tasks/:id returns a created task', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ title: 'Read docs' })
      .expect(201)

    const id = createRes.body.id

    const res = await request(expressApp).get(`/api/v1/tasks/${id}`).expect(200)

    expect(res.body).toHaveProperty('id', id)
    expect(res.body).toHaveProperty('title', 'Read docs')
  })

  it('DELETE /api/v1/tasks/:id removes the task', async () => {
    const { expressApp } = await createTestApp({ modules: [TaskModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/tasks')
      .send({ title: 'Temporary task' })
      .expect(201)

    const id = createRes.body.id

    await request(expressApp).delete(`/api/v1/tasks/${id}`).expect(204)

    await request(expressApp).get(`/api/v1/tasks/${id}`).expect(404)
  })
})
