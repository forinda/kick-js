/**
 * The fullstack web app proxies /api to the server's fixed port (3000). If
 * that port is taken, Vite's dev server moves to the next free one and the
 * proxy silently reaches whatever else holds 3000 — so the fullstack server
 * scaffolds with `strictPort`, making `kick dev` fail loudly instead.
 */
import { describe, expect, it } from 'vitest'

import { generateViteConfig } from '../src/generators/templates/project-config'

describe('generated vite.config.ts — strictPort', () => {
  it('sets server.strictPort for the fullstack server, with the reason', () => {
    const config = generateViteConfig({ strictPort: true })
    expect(config).toContain('strictPort: true')
    expect(config).toMatch(/proxies \/api to this port/)
  })

  it('leaves other templates on the Vite default', () => {
    expect(generateViteConfig()).not.toContain('strictPort')
    expect(generateViteConfig()).not.toContain('server:')
  })
})
