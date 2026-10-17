/**
 * `compressAssets()` — after `vite build`, write a `.br` and a `.gz` beside
 * every compressible file in the output, so the server sends a compressed
 * file instead of compressing on each request. KickJS's static serving
 * (`SpaAdapter`, `ctx.http.serveStatic`) picks the sibling the client accepts.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import type { Plugin } from 'vite'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

/** The extensions KickJS's static serving looks for a sibling of — keep in step with it. */
const COMPRESSIBLE = new Set([
  'html',
  'css',
  'js',
  'mjs',
  'json',
  'map',
  'webmanifest',
  'svg',
  'txt',
  'xml',
  'wasm',
])

export interface CompressAssetsOptions {
  /** Smallest file to compress, in bytes. Default 1024 — below that, headers outweigh the saving. */
  threshold?: number
  /** Which encodings to write. Default both. */
  encodings?: ReadonlyArray<'br' | 'gzip'>
}

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // Dotfiles (Vite's .vite/manifest.json) are build metadata, never served.
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (entry.isFile()) yield path
  }
}

/** Precompress a directory's compressible files in place; returns how many siblings were written. */
export async function compressDirectory(
  dir: string,
  options: CompressAssetsOptions = {},
): Promise<number> {
  const threshold = options.threshold ?? 1024
  const encodings = options.encodings ?? ['br', 'gzip']
  let written = 0
  for await (const file of files(dir)) {
    if (!COMPRESSIBLE.has(extname(file).slice(1).toLowerCase())) continue
    if ((await stat(file)).size < threshold) continue
    const source = await readFile(file)
    const variants: Array<[string, Promise<Buffer>]> = []
    if (encodings.includes('br')) {
      variants.push([
        '.br',
        brotli(source, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
          },
        }),
      ])
    }
    if (encodings.includes('gzip')) variants.push(['.gz', gz(source, { level: 9 })])
    for (const [ext, pending] of variants) {
      const compressed = await pending
      // Only when it saves something: the server would send the larger file otherwise.
      if (compressed.length >= source.length) continue
      await writeFile(file + ext, compressed)
      written++
    }
  }
  return written
}

/**
 * After the build, precompress the output directory. Client builds only: the
 * dev server is untouched, and an SSR build's output never reaches a browser.
 */
export function compressAssets(options: CompressAssetsOptions = {}): Plugin {
  let outDir = ''
  return {
    name: 'kickjs:compress-assets',
    apply: (_config, env) => env.command === 'build' && !env.isSsrBuild,
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const written = await compressDirectory(outDir, options)
      this.info(`precompressed ${written} file(s) in ${outDir}`)
    },
  }
}
