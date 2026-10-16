import type { TemplateContext } from './types'

/**
 * Controller test scaffold.
 *
 * Every case used to be `expect(true).toBe(true)`, so a generated module
 * reported a full green suite while asserting nothing — and kept reporting it
 * after the routes it names were deleted. A suite that passes unconditionally
 * is worse than no suite: it survives review and makes `pnpm test` stop
 * carrying information.
 *
 * Now: one case that genuinely exercises the module end to end, and `it.todo`
 * for the rest. Todos show up in the reporter as outstanding work and can
 * never be mistaken for coverage.
 */
export function generateControllerTest(ctx: TemplateContext): string {
  const { pascal, kebab, plural = '', style = 'define', testHarness = false } = ctx
  const route = ctx.routePath ?? plural
  // `define` modules are factories; `class` modules are passed as the class.
  // Getting this wrong yields `TypeError: entry is not a constructor`.
  const moduleEntry = style === 'define' ? `${pascal}Module()` : `${pascal}Module`

  // Without the harness installed, importing it would emit a file that cannot
  // compile — the same rule that gates `@ApiTags` on `swagger`. Those projects
  // get the identical scaffold with every case as a todo and no extra imports.
  const header = testHarness
    ? `import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container } from '@forinda/kickjs'
import { createTestApp } from '@forinda/kickjs-testing'

import { ${pascal}Module } from '../${kebab}.module'

/**
 * Where this module is mounted.
 *
 * \`createTestApp\` builds its own Application with the framework defaults —
 * apiPrefix \`/api\` and defaultVersion \`1\` — whatever your \`bootstrap()\` uses,
 * so this is correct as generated. If your app configures them differently,
 * pass the same values in \`boot()\` below and update this to match, so the test
 * exercises the paths production actually serves:
 *
 *   defaultVersion: false  →  '/api/${route}'
 *   apiPrefix: '/v1'       →  '/v1/v1/${route}'
 */
const BASE = '/api/v1/${route}'
`
    : `import { describe, it, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'

// Install \`@forinda/kickjs-testing\` and \`supertest\` to boot this module in a
// test: \`kick add @forinda/kickjs-testing\`. Until then every case below is a
// todo — the reporter lists them as outstanding rather than counting them as
// coverage.
`

  const listBlock = testHarness
    ? `  /**
   * Boot the module through the real pipeline.
   *
   * Drive \`app.handle\` rather than an Express app: it is the Application's own
   * Node listener, so this test runs on whichever runtime the app is
   * configured with.
   */
  async function boot() {
    const { app, container } = await createTestApp({
      modules: [${moduleEntry}],
      // Mirror your bootstrap() here if it overrides either, and update BASE:
      // apiPrefix: '/api',
      // defaultVersion: 1,
    })
    return { app, container, agent: request(app.handle.bind(app)) }
  }

  describe('GET /${route}', () => {
    it('returns an empty page before anything is created', async () => {
      const { agent } = await boot()
      const res = await agent.get(BASE)

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ data: [], meta: { page: 1 } })
    })

    it('filters and sorts through the query string', async () => {
      const { agent } = await boot()
      for (const name of ['Alpha', 'Beta', 'Gamma']) await agent.post(BASE).send({ name })
      const res = await agent.get(\`\${BASE}?filter=name:neq:Beta&sort=name:desc\`)

      expect(res.status).toBe(200)
      expect(res.body.data.map((row: { name: string }) => row.name)).toEqual(['Gamma', 'Alpha'])
      expect(res.body.meta.total).toBe(2)
    })

    it.todo('returns created ${plural}, paginated')
  })`
    : `  describe('GET /${route}', () => {
    // Boot the module with createTestApp and assert { data, meta }.
    it.todo('returns an empty page before anything is created')
    it.todo('returns created ${plural}, paginated')
  })`

  return `${header}
describe('${pascal}Controller', () => {
  beforeEach(() => {
    Container.reset()
  })

${listBlock}

  // The cases below are scaffolding, not coverage. Each is \`it.todo\` so the
  // reporter lists it as outstanding instead of counting it as a pass. Replace
  // the todo with a real test as you implement each endpoint.

  describe('POST /${route}', () => {
${
  testHarness
    ? `    it('creates a ${kebab} and points Location at it', async () => {
      const { agent } = await boot()
      const res = await agent.post(BASE).send({ name: 'Test ${pascal}' })

      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({ name: 'Test ${pascal}' })
      expect(res.headers.location).toBe(\`\${BASE}/\${res.body.id}\`)
    })`
    : `    // Post a valid body, assert 201, the created ${kebab}, and its Location header.
    it.todo('creates a ${kebab}')`
}
    // Post an invalid body, assert 422 and the validation detail.
    it.todo('rejects an invalid body')
  })

  describe('GET /${route}/:id', () => {
    // Create one, fetch it by id, assert the payload matches.
    it.todo('returns a ${kebab} by id')
    // Fetch an id that does not exist, assert 404.
    it.todo('returns 404 for an unknown id')
  })

  describe('PATCH /${route}/:id', () => {
    // Create, update, assert the change is reflected on a subsequent read.
    it.todo('updates an existing ${kebab}')
  })

  describe('DELETE /${route}/:id', () => {
    // Create, delete, assert a subsequent read is 404.
    it.todo('deletes a ${kebab}')
  })
})
`
}

export function generateRepositoryTest(ctx: TemplateContext): string {
  const { pascal, kebab, plural = '', repoPrefix = `../${kebab}.repository` } = ctx
  const factory = `create${pascal}Repository`

  return `import { describe, it, expect, beforeEach } from 'vitest'
import { ${factory}, type ${pascal}Repository } from '${repoPrefix}'

describe('${pascal} repository', () => {
  let repo: ${pascal}Repository

  beforeEach(() => {
    repo = ${factory}()
  })

  it('should create and retrieve a ${kebab}', async () => {
    const created = await repo.create({ name: 'Test ${pascal}' })
    expect(created).toBeDefined()
    expect(created.name).toBe('Test ${pascal}')
    expect(created.id).toBeDefined()

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('should return null for non-existent id', async () => {
    const found = await repo.findById('non-existent')
    expect(found).toBeNull()
  })

  it('should list all ${plural}', async () => {
    await repo.create({ name: '${pascal} 1' })
    await repo.create({ name: '${pascal} 2' })

    const all = await repo.findAll()
    expect(all).toHaveLength(2)
  })

  it('should return paginated results', async () => {
    await repo.create({ name: '${pascal} 1' })
    await repo.create({ name: '${pascal} 2' })
    await repo.create({ name: '${pascal} 3' })

    const result = await repo.findPaginated({
      filters: [],
      sort: [],
      search: '',
      pagination: { page: 1, limit: 2, offset: 0 },
    })

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(3)
  })

  it('should filter, search and sort before paginating', async () => {
    await repo.create({ name: 'Banana' })
    await repo.create({ name: 'apple' })
    await repo.create({ name: 'Cherry' })
    const pagination = { page: 1, limit: 10, offset: 0 }

    const sorted = await repo.findPaginated({
      filters: [],
      sort: [{ field: 'name', direction: 'desc' }],
      search: '',
      pagination,
    })
    expect(sorted.data.map((row) => row.name)).toEqual(['Cherry', 'Banana', 'apple'])

    const filtered = await repo.findPaginated({
      filters: [{ field: 'name', operator: 'neq', value: 'apple' }],
      sort: [],
      search: '',
      pagination: { page: 1, limit: 1, offset: 0 },
    })
    expect(filtered.data).toHaveLength(1)
    expect(filtered.total).toBe(2)

    const searched = await repo.findPaginated({ filters: [], sort: [], search: 'AN', pagination })
    expect(searched.data.map((row) => row.name)).toEqual(['Banana'])
  })

  it('compares a text field as text, not as a number', async () => {
    await repo.create({ name: '001' })
    await repo.create({ name: '10' })
    await repo.create({ name: '9' })
    const pagination = { page: 1, limit: 10, offset: 0 }

    const exact = await repo.findPaginated({
      filters: [{ field: 'name', operator: 'eq', value: '1' }],
      sort: [],
      search: '',
      pagination,
    })
    expect(exact.total).toBe(0)

    const sorted = await repo.findPaginated({
      filters: [],
      sort: [{ field: 'name', direction: 'asc' }],
      search: '',
      pagination,
    })
    expect(sorted.data.map((row) => row.name)).toEqual(['001', '10', '9'])
  })

  it('pages through rows with findAfter, stable when sort keys tie', async () => {
    // Three rows share 'a', so a page boundary falls inside the tie: only the
    // id tie-breaker keeps the third 'a' from being skipped or repeated.
    for (const name of ['b', 'a', 'b', 'a', 'a']) await repo.create({ name })
    const query = { filters: [], sort: [{ field: 'name', direction: 'asc' as const }], search: '' }
    const limit = 2

    const pages: string[][] = []
    const ids: string[] = []
    let cursor: Record<string, unknown> | null = null
    let hasNext = true
    while (hasNext) {
      // Ask for one more than a page, as ctx.paginateCursor's fetcher does.
      const rows = await repo.findAfter({ ...query, cursor, limit: limit + 1 })
      hasNext = rows.length > limit
      const page = rows.slice(0, limit)
      pages.push(page.map((row) => row.name))
      ids.push(...page.map((row) => row.id))
      const last = page.at(-1)
      cursor = last ? { name: last.name, id: last.id } : null
    }

    expect(pages.map((page) => page.length)).toEqual([2, 2, 1])
    expect(pages.flat()).toEqual(['a', 'a', 'a', 'b', 'b'])
    expect(new Set(ids).size).toBe(5)
  })

  it('should update a ${kebab}', async () => {
    const created = await repo.create({ name: 'Original' })
    const updated = await repo.update(created.id, { name: 'Updated' })
    expect(updated.name).toBe('Updated')
  })

  it('should delete a ${kebab}', async () => {
    const created = await repo.create({ name: 'To Delete' })
    await repo.delete(created.id)
    const found = await repo.findById(created.id)
    expect(found).toBeNull()
  })
})
`
}
