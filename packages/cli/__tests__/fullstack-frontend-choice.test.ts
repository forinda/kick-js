/**
 * `kick new --template fullstack` can hand `web/` to create-vite instead of
 * writing the wired React app. Nothing is patched afterwards, so the one
 * thing that has to be right is the command each package manager runs.
 */
import { describe, expect, it } from 'vitest'

import { FRONTEND_WIRING_URL, createViteCommand, rootReadme } from '../src/generators/fullstack'

describe('createViteCommand', () => {
  it('passes the versioned package name where the manager needs one', () => {
    expect(createViteCommand('pnpm', 'web')).toEqual(['pnpm', 'create', 'vite@latest', 'web'])
    expect(createViteCommand('npm', 'web')).toEqual(['npm', 'create', 'vite@latest', 'web'])
  })

  it('lets yarn and bun resolve create-vite themselves', () => {
    expect(createViteCommand('yarn', 'web')).toEqual(['yarn', 'create', 'vite', 'web'])
    expect(createViteCommand('bun', 'web')).toEqual(['bun', 'create', 'vite', 'web'])
  })

  it('names no framework: create-vite prompts for it', () => {
    // Delegation means the framework is the user's choice, not ours.
    for (const pm of ['pnpm', 'npm', 'yarn', 'bun'] as const) {
      expect(createViteCommand(pm, 'web').join(' ')).not.toContain('--template')
    }
  })
})

describe('FRONTEND_WIRING_URL', () => {
  it('points at the guide the scaffold prints', () => {
    // The page exists in docs/guide; the CLI prints this instead of wiring.
    expect(FRONTEND_WIRING_URL).toBe('https://kickjs.app/guide/fullstack-frontend.html')
  })
})

describe('rootReadme', () => {
  it('describes the wired app, and its type loop, for the KickJS frontend', () => {
    const readme = rootReadme('demo', 'pnpm', 'kick')
    expect(readme).toContain('@forinda/kickjs-client')
    expect(readme).toContain('## The type loop')
  })

  it('describes create-vite output as unwired, and links the guide', () => {
    const readme = rootReadme('demo', 'pnpm', 'vite')
    // Nothing in a create-vite scaffold is typed against the API yet, so the
    // type loop and the proxy note would both be fiction.
    expect(readme).not.toContain('## The type loop')
    expect(readme).not.toContain('Vite proxies')
    expect(readme).not.toContain('typed against the API via')
    expect(readme).toContain('## Wiring web/ to the API')
    expect(readme).toContain(FRONTEND_WIRING_URL)
  })
})
