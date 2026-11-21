/** The edge entry has no file system: a custom loader without catalogues must still render. */
import { describe, expect, it } from 'vitest'
import { createViews } from '../src/edge'

describe('edge views without catalogues', () => {
  it('renders with a custom loader', async () => {
    const v = createViews({
      loader: { list: async () => ['page'], read: async () => '<p>{{ name }}</p>' },
      pipes: {},
    })
    expect(await v.render('page', { name: 'A' })).toBe('<p>A</p>')
  })
})
