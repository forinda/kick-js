/** `share` gets the request: `ctx.get(...)` and a `{ req }` helper type-check without a cast. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createViews } from '../src/index'

// The shape of kickjs's `csrfToken(ctx)`.
const tokenOf = (ctx: { req: unknown } | undefined) =>
  (ctx?.req as { token?: string } | undefined)?.token

describe('share', () => {
  it('reads the request it renders in', async () => {
    const viewsDir = mkdtempSync(join(tmpdir(), 'kick-share-'))
    writeFileSync(join(viewsDir, 'page.kick'), '{{ user }} {{ token }}')
    const views = createViews({
      viewsDir,
      warn: vi.fn(),
      share: (ctx) => ({ user: ctx?.get('user'), token: tokenOf(ctx) }),
    })
    const ctx = { req: { token: 't1' }, get: (k: string) => (k === 'user' ? 'ada' : undefined) }
    expect(await views.render('page', {}, { ctx })).toBe('ada t1')
  })
})
