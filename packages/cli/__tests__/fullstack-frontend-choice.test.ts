/**
 * `kick new --template fullstack` can hand `web/` to create-vite instead of
 * writing the wired React app. Nothing is patched afterwards, so the one
 * thing that has to be right is the command each package manager runs.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VITE_TEMPLATE,
  FRONTEND_WIRING_URL,
  VITE_TEMPLATES,
  createViteCommand,
  rootReadme,
} from '../src/generators/fullstack'

describe('createViteCommand', () => {
  it('names a TypeScript template so the wiring guide applies', () => {
    expect(createViteCommand('pnpm', 'web')).toEqual([
      'pnpm',
      'create',
      'vite@latest',
      'web',
      '--template',
      'react-ts',
      '--no-interactive',
      '--no-immediate',
    ])
  })

  it('passes npm the -- separator, or npm eats the flags itself', () => {
    expect(createViteCommand('npm', 'web', 'vue-ts').slice(0, 6)).toEqual([
      'npm',
      'create',
      'vite@latest',
      'web',
      '--',
      '--template',
    ])
  })

  it('lets yarn and bun resolve create-vite themselves', () => {
    expect(createViteCommand('yarn', 'web', 'svelte-ts').slice(0, 4)).toEqual([
      'yarn',
      'create',
      'vite',
      'web',
    ])
    expect(createViteCommand('bun', 'web').slice(0, 4)).toEqual(['bun', 'create', 'vite', 'web'])
  })

  it('never waits for input, and never starts a dev server', () => {
    // --yes has to stay unattended, and the workspace install happens once at
    // the root after this returns.
    for (const pm of ['pnpm', 'npm', 'yarn', 'bun'] as const) {
      const command = createViteCommand(pm, 'web').join(' ')
      expect(command).toContain('--no-interactive')
      expect(command).toContain('--no-immediate')
    }
  })

  it('offers only TypeScript templates', () => {
    // A JavaScript template leaves the reader with a guide that cannot apply:
    // the route map is a .d.ts and the client is createClient<...>.
    for (const template of VITE_TEMPLATES) expect(template.value).toMatch(/-ts$/)
    expect(VITE_TEMPLATES.some((t) => t.value === DEFAULT_VITE_TEMPLATE)).toBe(true)
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
