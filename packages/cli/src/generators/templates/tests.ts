import type { TemplateContext } from './types'

export function generateControllerTest(ctx: TemplateContext): string {
  const { pascal, kebab, plural = '' } = ctx
  return `import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs-core'

describe('${pascal}Controller', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('should be defined', () => {
    expect(true).toBe(true)
  })

  describe('POST /${plural}', () => {
    it('should create a new ${kebab}', async () => {
      // TODO: Set up test module, call create endpoint, assert 201
      expect(true).toBe(true)
    })
  })

  describe('GET /${plural}', () => {
    it('should return paginated ${plural}', async () => {
      // TODO: Set up test module, call list endpoint, assert { data, meta }
      expect(true).toBe(true)
    })
  })

  describe('GET /${plural}/:id', () => {
    it('should return a ${kebab} by id', async () => {
      // TODO: Create a ${kebab}, then fetch by id, assert match
      expect(true).toBe(true)
    })

    it('should return 404 for non-existent ${kebab}', async () => {
      // TODO: Fetch non-existent id, assert 404
      expect(true).toBe(true)
    })
  })

  describe('PUT /${plural}/:id', () => {
    it('should update an existing ${kebab}', async () => {
      // TODO: Create, update, assert changes
      expect(true).toBe(true)
    })
  })

  describe('DELETE /${plural}/:id', () => {
    it('should delete a ${kebab}', async () => {
      // TODO: Create, delete, assert gone
      expect(true).toBe(true)
    })
  })
})
`
}

export function generateRepositoryTest(ctx: TemplateContext): string {
  const {
    pascal,
    kebab,
    plural = '',
    repoPrefix = `../infrastructure/repositories/in-memory-${kebab}.repository`,
  } = ctx
  return `import { describe, it, expect, beforeEach } from 'vitest'
import { InMemory${pascal}Repository } from '${repoPrefix}'

describe('InMemory${pascal}Repository', () => {
  let repo: InMemory${pascal}Repository

  beforeEach(() => {
    repo = new InMemory${pascal}Repository()
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
