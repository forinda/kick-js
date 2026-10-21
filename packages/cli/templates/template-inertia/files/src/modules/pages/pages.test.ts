import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '@forinda/kickjs-testing'
import { InertiaAdapter } from '@forinda/kickjs-inertia'
// @kick:imports
import { PagesModule } from './pages.module'

// No client build or `kick dev` needed: without one, pages render without
// their scripts. `version` is pinned so an Inertia visit that sends it isn't
// answered 409 once the client has been built.
async function boot() {
  const { app } = await createTestApp({
    // The app's own engine: without one, createTestApp uses Express.
    // @kick:runtime
    modules: [PagesModule()],
    adapters: [InertiaAdapter({ version: 'test' })],
  })
  return request(app.handle.bind(app))
}

const inertiaVisit = { 'X-Inertia': 'true', 'X-Inertia-Version': 'test' }

describe('PagesController', () => {
  it('renders the home page as HTML on a first visit', async () => {
    const res = await (await boot()).get('/').expect(200)
    expect(res.headers['content-type']).toMatch(/html/)
    expect(res.text).toContain('"component":"Home"')
    // The controller's meta is in the HTML a search engine reads.
    expect(res.text).toContain('<title data-inertia="">Home</title>')
  })

  it('answers an Inertia visit with the page as JSON', async () => {
    const res = await (await boot()).get('/posts').set(inertiaVisit).expect(200)
    expect(res.body.component).toBe('Posts/Index')
    expect(res.body.props.posts).toEqual([{ id: 1, title: 'Hello from KickJS' }])
  })
})
