/**
 * What the server reports for a template equals `parse` + `check` run
 * directly — messages, severities and ranges — over the guide's examples and
 * a set of broken templates.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import * as view from '@forinda/kickjs-view'
import { startLanguageServer, type LanguageServerHandle } from '@volar/test-utils'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toRange } from '../src/positions'

type D = {
  message: string
  severity: number
  range: { start: { line: number; character: number } }
}
/** Volar doesn't keep the engine's order. */
const sorted = (ds: D[]) =>
  ds.toSorted(
    (a, b) =>
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character ||
      a.message.localeCompare(b.message),
  )

const BIN = resolve(import.meta.dirname, '../bin/kick-view-ls.js')
const APP = resolve(import.meta.dirname, 'fixtures/app')
const VIEWS = join(APP, 'src/views')

const guide = readFileSync(resolve(import.meta.dirname, '../../../docs/guide/views.md'), 'utf8')
const CORPUS: string[] = [
  ...[...guide.matchAll(/```kick\n([\s\S]*?)\n```/g)].map((m) => m[1]!),
  '<p>{{ a | nope }}</p>',
  '@if (a) {\n<p>',
  '<user-card />',
  '<user-card [user]="u" [nope]="1" />',
  '<p>{{ a + }}</p>',
  '@for (x of xs) {\n{{ y }}\n}',
  "@layout('layouts/missing')\n<p></p>",
  '<missing-thing />',
  '@switch (a) { @case (1) { x } @case (1) { y } }',
]

/** `parse` + `check` over the fixture app with `src` as `name`. */
function direct(name: string, src: string) {
  const templates = new Map<string, view.TemplateAst>()
  for (const f of readdirSync(VIEWS, { recursive: true }) as string[]) {
    if (!f.endsWith('.kick')) continue
    const n = view.templateName(relative(VIEWS, join(VIEWS, f)).slice(0, -5))
    if (!n) continue
    templates.set(n, view.parse(readFileSync(join(VIEWS, f), 'utf8'), `${n}.kick`).ast)
  }
  const parsed = view.parse(src, `${name}.kick`)
  templates.set(name, parsed.ast)
  const pipes = view.readPipeExports(
    readFileSync(join(VIEWS, 'pipes.ts'), 'utf8'),
    'pipes.ts',
  ).names
  const all = parsed.diagnostics.some((d) => d.severity === 'error')
    ? parsed.diagnostics
    : [
        ...parsed.diagnostics,
        ...view.check(name, {
          templates,
          pipes: new Set([...view.BUILTIN_PIPES, ...pipes]),
          componentsDir: 'components',
        }).diagnostics,
      ]
  return all.map((d) => ({
    message: d.message,
    severity: d.severity === 'error' ? 1 : 2,
    range: toRange(d.span),
  }))
}

describe('server diagnostics equal parse + check', () => {
  let server: LanguageServerHandle
  beforeAll(async () => {
    server = startLanguageServer(BIN, APP)
    await server.initialize(URI.file(APP).toString(), {}, {})
  }, 30_000)
  afterAll(() => server?.shutdown())

  for (const [i, src] of CORPUS.entries()) {
    it(`sample ${i + 1}`, async () => {
      const name = `diff-${i + 1}`
      const uri = URI.file(join(VIEWS, `${name}.kick`)).toString()
      await server.openInMemoryDocument(uri, 'kick', src)
      const report = (await server.sendDocumentDiagnosticRequest(uri)) as {
        items: { message: string; severity: number; range: unknown; source?: string }[]
      }
      const got = report.items
        .filter((d) => d.source === 'kick')
        .map(({ message, severity, range }) => ({ message, severity, range }))
      expect(sorted(got as D[])).toEqual(sorted(direct(name, src)))
    })
  }
  it('the corpus has broken samples', () => {
    expect(CORPUS.filter((s, i) => direct(`diff-${i + 1}`, s).length).length).toBeGreaterThan(5)
  })
})
