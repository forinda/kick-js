import { describe, expect, it } from 'vitest'
import { filterItems, matchScore, type PaletteItem } from '../spa/src/lib/palette-core'

const item = (title: string, description?: string): PaletteItem => ({
  id: title,
  title,
  description,
  group: 'g',
  icon: 'routes',
  run: () => {},
})

describe('command palette matching', () => {
  it('ranks a word-start substring above a mid-word one', () => {
    expect(matchScore('users', '/users/:id')!).toBeGreaterThan(
      matchScore('users', '/api/v1/superusers')!,
    )
  })

  it('matches characters in order with gaps, and rejects out-of-order', () => {
    expect(matchScore('gtu', 'GET /users')).not.toBeNull()
    expect(matchScore('utg', 'GET /users')).toBeNull()
  })

  it('keeps every item in order for an empty query', () => {
    const items = [item('b'), item('a')]
    expect(filterItems(items, '  ').map((i) => i.title)).toEqual(['b', 'a'])
  })

  it('matches descriptions below titles', () => {
    const items = [item('GET /x', 'UsersController.list'), item('Users')]
    expect(filterItems(items, 'users').map((i) => i.title)).toEqual(['Users', 'GET /x'])
  })
})
