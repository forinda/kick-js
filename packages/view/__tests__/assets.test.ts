import { describe, expect, it } from 'vitest'
import { assetTags } from '../src/assets'

const manifest = {
  'src/client/main.ts': {
    file: 'assets/main-abc.js',
    css: ['assets/main-abc.css'],
    imports: ['_vendor.js'],
    isEntry: true,
  },
  '_vendor.js': { file: 'assets/vendor-def.js' },
}

describe('assetTags', () => {
  it('dev: the Vite client and the module', () => {
    expect(assetTags('src/client/main.ts', { dev: true, base: '/' })).toBe(
      '<script type="module" src="/@vite/client"></script>\n<script type="module" src="/src/client/main.ts"></script>',
    )
  })

  it('build: hashed script, CSS and preloads from the manifest', () => {
    expect(assetTags('src/client/main.ts', { dev: false, manifest, base: '/' })).toBe(
      [
        '<link rel="stylesheet" href="/assets/main-abc.css">',
        '<link rel="modulepreload" href="/assets/vendor-def.js">',
        '<script type="module" src="/assets/main-abc.js"></script>',
      ].join('\n'),
    )
  })

  it('adds the nonce to each tag', () => {
    const out = assetTags('src/client/main.ts', { dev: false, manifest, base: '/' }, 'n"1')
    expect(out.match(/nonce="n&quot;1"/g)).toHaveLength(3)
  })

  it('an unknown entry is an error', () => {
    expect(() => assetTags('nope.ts', { dev: false, manifest, base: '/' })).toThrow("'nope.ts'")
  })
})
