import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'
import { ProductsModule } from './modules/products'

describe('DevTools API — ProductsController', () => {
  beforeEach(() => Container.reset())

  it('GET /api/v1/products returns an empty list initially', async () => {
    const { expressApp } = await createTestApp({ modules: [ProductsModule] })

    const res = await request(expressApp).get('/api/v1/products').expect(200)

    expect(res.body).toEqual([])
  })

  it('POST /api/v1/products creates a product and returns 201', async () => {
    const { expressApp } = await createTestApp({ modules: [ProductsModule] })

    const res = await request(expressApp)
      .post('/api/v1/products')
      .send({ name: 'Widget' })
      .expect(201)

    expect(res.body).toHaveProperty('id')
    expect(res.body).toHaveProperty('name', 'Widget')
  })

  it('GET /api/v1/products/:id returns a created product', async () => {
    const { expressApp } = await createTestApp({ modules: [ProductsModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/products')
      .send({ name: 'Gadget' })
      .expect(201)

    const id = createRes.body.id

    const res = await request(expressApp).get(`/api/v1/products/${id}`).expect(200)

    expect(res.body).toHaveProperty('id', id)
    expect(res.body).toHaveProperty('name', 'Gadget')
  })

  it('GET /api/v1/products/:id returns 404 for non-existent product', async () => {
    const { expressApp } = await createTestApp({ modules: [ProductsModule] })

    await request(expressApp).get('/api/v1/products/non-existent-id').expect(404)
  })

  it('DELETE /api/v1/products/:id removes the product', async () => {
    const { expressApp } = await createTestApp({ modules: [ProductsModule] })

    const createRes = await request(expressApp)
      .post('/api/v1/products')
      .send({ name: 'Temp' })
      .expect(201)

    const id = createRes.body.id

    await request(expressApp).delete(`/api/v1/products/${id}`).expect(204)

    await request(expressApp).get(`/api/v1/products/${id}`).expect(404)
  })
})
