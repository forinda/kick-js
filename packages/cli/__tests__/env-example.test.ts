import { describe, expect, it } from 'vitest'
import { renderEnvExample } from '../src/commands/env'

describe('renderEnvExample', () => {
  it('writes required variables bare, optional ones commented with their default', () => {
    const text = renderEnvExample({
      env: [
        { name: 'PORT', required: false, default: 3000, list: false },
        { name: 'SESSION_SECRET', required: true, description: 'Signs cookies', list: false },
      ],
      sections: [
        {
          prefix: 'DB',
          declaredBy: 'module DbModule',
          vars: [
            { name: 'DB_URL', required: true, list: false },
            { name: 'DB_REPLICAS', required: false, default: ['a', 'b'], list: true },
            { name: 'DB_TLS', required: false, list: false },
          ],
        },
      ],
    })
    expect(text).toContain(
      '# ── App env schema ──\n# PORT=3000\n# Signs cookies\nSESSION_SECRET=\n',
    )
    expect(text).toContain('# ── DB settings (declared by module DbModule) ──\nDB_URL=\n')
    expect(text).toContain('# comma-separated list\n# DB_REPLICAS=a,b\n# DB_TLS=\n')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toMatch(/\n\n\n/)
  })

  it('keeps multi-line descriptions and defaults inside comments', () => {
    const text = renderEnvExample({
      env: [
        {
          name: 'GREETING',
          required: false,
          default: 'hi\nthere',
          description: 'Shown on\nthe home page',
          list: false,
        },
      ],
      sections: [],
    })
    expect(text).toContain('# Shown on\n# the home page\n# GREETING="hi\\nthere"\n')
  })

  it('omits the env block when there is no schema', () => {
    expect(renderEnvExample({ env: [], sections: [] })).not.toContain('App env schema')
  })
})
