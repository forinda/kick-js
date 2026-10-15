/**
 * `ViewAdapter` finds templates in a build: `copyDirs: ['src/views']` copies
 * them to `dist/src/views`, and a container holding only `dist/` must render.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ViewAdapter, viewDirs } from '../src/http/middleware/views'

let image: string
const saved = { cwd: process.cwd(), argv1: process.argv[1], root: process.env.KICK_APP_ROOT }

beforeEach(() => {
  image = mkdtempSync(join(tmpdir(), 'kick-views-'))
  mkdirSync(join(image, 'dist', 'src', 'views'), { recursive: true })
  writeFileSync(join(image, 'dist', 'src', 'views', 'home.html'), 'Hello, {{name}}!')
})
afterEach(() => {
  process.chdir(saved.cwd)
  process.argv[1] = saved.argv1!
  if (saved.root === undefined) delete process.env.KICK_APP_ROOT
  else process.env.KICK_APP_ROOT = saved.root
  rmSync(image, { recursive: true, force: true })
})

const engine = (
  path: string,
  data: Record<string, string>,
  done: (e: null, html: string) => void,
) => done(null, readFileSync(path, 'utf-8').replace('{{name}}', data.name))

function render(): Promise<string> {
  const app = express()
  const adapter = ViewAdapter({ engine, ext: 'html' })
  adapter.beforeMount!({ app } as never)
  return new Promise((done, fail) =>
    app.render('home', { name: 'World' }, (err, html) => (err ? fail(err) : done(html!))),
  )
}

it('renders from dist/src/views when only the build is deployed (node dist/index.js)', async () => {
  process.chdir(image) // the image's WORKDIR: no src/ there
  process.argv[1] = join(image, 'dist', 'index.js')
  expect(await render()).toBe('Hello, World!')
})

it('looks in the project first — the source in dev, KICK_APP_ROOT in a function', () => {
  process.env.KICK_APP_ROOT = '/var/task'
  process.argv[1] = '/var/runtime/index.mjs'
  expect(viewDirs('src/views')).toEqual(['/var/task/src/views', '/var/runtime/src/views'])
})
