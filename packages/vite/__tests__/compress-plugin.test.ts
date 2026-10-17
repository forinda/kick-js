/** compressAssets(): a real `vite build` leaves `.br` / `.gz` beside the compressible output. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { compressAssets, compressDirectory } from '../src/compress-plugin'

describe('compressAssets', () => {
  it('writes siblings for the built JS and CSS, decodable to the originals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kick-compress-'))
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head>' +
        '<body><script type="module" src="./main.js"></script></body></html>',
    )
    writeFileSync(join(root, 'main.js'), `console.log(${JSON.stringify('x'.repeat(4000))})\n`)
    // Distinct rules: minifying would collapse repeated ones below the threshold.
    writeFileSync(
      join(root, 'style.css'),
      Array.from({ length: 200 }, (_, i) => `.c${i} { margin: ${i}px }`).join('\n'),
    )

    await build({ root, logLevel: 'silent', plugins: [compressAssets()] })

    const assets = join(root, 'dist/assets')
    const js = readdirSync(assets).find((f) => f.endsWith('.js'))!
    const css = readdirSync(assets).find((f) => f.endsWith('.css'))!
    for (const file of [js, css]) {
      const original = readFileSync(join(assets, file))
      expect(brotliDecompressSync(readFileSync(join(assets, `${file}.br`)))).toEqual(original)
      expect(gunzipSync(readFileSync(join(assets, `${file}.gz`)))).toEqual(original)
    }
  })

  it('skips small files, other types, and a variant that saves nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-compress-'))
    writeFileSync(join(dir, 'small.js'), 'console.log(1)\n')
    writeFileSync(join(dir, 'photo.png'), Buffer.alloc(4096, 7))
    // Random bytes don't compress: no sibling is smaller.
    writeFileSync(
      join(dir, 'noise.txt'),
      Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))),
    )
    writeFileSync(join(dir, 'big.svg'), `<svg>${'<g/>'.repeat(1000)}</svg>`)

    expect(await compressDirectory(dir, { encodings: ['gzip'] })).toBe(1)
    expect(existsSync(join(dir, 'big.svg.gz'))).toBe(true)
    expect(existsSync(join(dir, 'big.svg.br'))).toBe(false)
    expect(existsSync(join(dir, 'small.js.gz'))).toBe(false)
    expect(existsSync(join(dir, 'photo.png.gz'))).toBe(false)
    expect(existsSync(join(dir, 'noise.txt.gz'))).toBe(false)
  })

  it('removes a copy the current build no longer writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-compress-'))
    const file = join(dir, 'app.js')
    writeFileSync(file, 'console.log(1)\n'.repeat(200))
    await compressDirectory(dir)
    expect(existsSync(`${file}.br`)).toBe(true)

    // Gzip only now: the old .br would otherwise be served for the new file.
    writeFileSync(file, 'console.log(2)\n'.repeat(200))
    await compressDirectory(dir, { encodings: ['gzip'] })
    expect(existsSync(`${file}.br`)).toBe(false)
    expect(gunzipSync(readFileSync(`${file}.gz`)).toString()).toContain('console.log(2)')

    // Under the threshold now: no copy at all.
    writeFileSync(file, 'x')
    await compressDirectory(dir)
    expect(existsSync(`${file}.gz`)).toBe(false)
  })

  it('does nothing when the build writes nothing (build.write: false)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kick-compress-'))
    writeFileSync(join(root, 'index.html'), '<script type="module" src="./main.js"></script>')
    writeFileSync(join(root, 'main.js'), `console.log(${JSON.stringify('x'.repeat(4000))})\n`)
    await build({ root, logLevel: 'silent', build: { write: false }, plugins: [compressAssets()] })
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })

  it('runs on client builds only', () => {
    const apply = compressAssets().apply as (c: object, env: object) => boolean
    expect(apply({}, { command: 'build', isSsrBuild: false })).toBe(true)
    expect(apply({}, { command: 'build', isSsrBuild: true })).toBe(false)
    expect(apply({}, { command: 'serve' })).toBe(false)
  })

  it('leaves dot-directories alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-compress-'))
    mkdirSync(join(dir, '.vite'))
    writeFileSync(join(dir, '.vite/manifest.json'), JSON.stringify({ a: 'x'.repeat(4000) }))
    expect(await compressDirectory(dir)).toBe(0)
  })
})
