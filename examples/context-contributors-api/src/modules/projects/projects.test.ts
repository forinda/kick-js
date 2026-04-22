import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'
import { StartedAt } from '../../contributors'
import { FlagsAdapter } from '../../adapters/flags.adapter'
import { ProjectsModule } from './projects.module'

beforeEach(() => {
  Container.reset()
})

async function setupApp() {
  return createTestApp({
    modules: [ProjectsModule],
    adapters: [new FlagsAdapter()],
    contributors: [StartedAt.registration],
    middleware: [express.json()],
  })
}

describe('context-contributors-api — all five registration sites reach the handler', () => {
  it('GET /projects/:id sees global + adapter + module + class + method keys', async () => {
    const { expressApp } = await setupApp()

    const res = await request(expressApp).get('/api/v1/projects/p-1')
    expect(res.status).toBe(200)
    expect(res.body.tenant).toEqual({ id: 'demo-tenant', name: 'Demo Tenant' })
    expect(res.body.project).toEqual({ id: 'p-1', tenantId: 'demo-tenant', title: 'Onboarding' })
    expect(res.body.auditTrailEnabled).toBe(true)
    expect(res.body.flags).toEqual({ beta: false, rolloutPercentage: 25 })
    expect(typeof res.body.requestStartedAt).toBe('number')
  })

  it('GET /projects/ sees every key except `project` (method-scoped)', async () => {
    const { expressApp } = await setupApp()

    const res = await request(expressApp).get('/api/v1/projects/')
    expect(res.status).toBe(200)
    expect(res.body.tenant).toEqual({ id: 'demo-tenant', name: 'Demo Tenant' })
    expect(res.body.auditTrailEnabled).toBe(true)
    expect(res.body.flags).toEqual({ beta: false, rolloutPercentage: 25 })
  })
})
