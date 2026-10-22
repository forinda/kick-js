import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_PIPES, builtinPipes, pipesFor, safeHtml, withEnv } from '../src/pipes/env'
import { readPipeExports } from '../src/pipes/read-exports'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { render, RenderError } from '../src/render/render'
import { SafeHtml } from '../src/render/safe'

const env = { locale: 'en-US', timeZone: 'UTC' }
const p = builtinPipes(env)

function renderWith(src: string, data: object, pipes = p) {
  const project = {
    templates: new Map([['page', parse(src, 'page.kick').ast]]),
    pipes: new Set(Object.keys(pipes)),
    componentsDir: 'components',
  }
  const t = check('page', project)
  if (!t.template) throw new Error(t.diagnostics.map((d) => d.message).join())
  return render(t.template, data, {
    ...env,
    strict: false,
    pipes,
    warn: vi.fn(),
    resolve: () => t.template!,
  })
}

describe('pipes', () => {
  it('lists the built-ins', () => {
    expect([...BUILTIN_PIPES].toSorted()).toEqual(
      [
        'currency',
        'date',
        'entries',
        'json',
        'keys',
        'lowercase',
        'number',
        'percent',
        'raw',
        'slice',
        'titlecase',
        'uppercase',
        'url',
      ].toSorted(),
    )
  })

  it('date pipe uses UTC by default', () => {
    const d = new Date('2026-01-01T23:30:00Z')
    expect(p.date!(d, 'short')).toContain('1/1/26')
    expect(builtinPipes({ ...env, timeZone: 'Africa/Nairobi' }).date!(d, 'short')).toContain(
      '1/2/26',
    )
    expect(p.date!(d, 'short', 'Africa/Nairobi')).toContain('1/2/26')
    expect(p.date!('not a date', 'short')).toBe('')
    expect(p.date!(null, 'short')).toBe('')
  })

  it('number digits', () => {
    expect(p.number!(1.23456, '1.0-2')).toBe('1.23')
    expect(p.number!(5, '3.2-2')).toBe('005.00')
    expect(p.number!(1234.5)).toBe('1,234.5')
    expect(builtinPipes({ ...env, locale: 'de-DE' }).number!(1234.5, '1.2-2')).toBe('1.234,50')
  })

  it('formats and slices', () => {
    expect(p.currency!(1500, 'KES')).toContain('1,500.00')
    expect(p.percent!(0.256, '1.0-1')).toBe('25.6%')
    expect(p.slice!('abcd', 1, 3)).toBe('bc')
    expect(p.slice!([1, 2, 3], 1)).toEqual([2, 3])
    expect(p.url!('a b&c')).toBe('a%20b%26c')
    expect(p.uppercase!('ab')).toBe('AB')
    expect(p.lowercase!('AB')).toBe('ab')
    expect(p.titlecase!('hello wide world')).toBe('Hello Wide World')
    expect(p.keys!({ a: 1, b: 2 })).toEqual(['a', 'b'])
    expect(p.entries!({ a: 1 })).toEqual([['a', 1]])
    expect(p.entries!(new Map([['k', 2]]))).toEqual([['k', 2]])
    expect(p.raw!('<b>')).toBeInstanceOf(SafeHtml)
    expect(p.json!({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('pipes are sync', () => {
    const later = { ...p, later: () => Promise.resolve(1) }
    expect(() => renderWith('{{ x | later }}', { x: 1 }, later)).toThrow(
      /pipes must be synchronous/,
    )
  })

  it('json pipe reports cycles', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    try {
      renderWith('<p>\n{{ a | json }}</p>', { a })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RenderError)
      expect((e as RenderError).diagnostic.span.start.line).toBe(2)
    }
  })

  it('withEnv receives the render env', () => {
    const app = {
      where: withEnv(
        ({ locale, timeZone }) =>
          (v: unknown) =>
            `${v}@${locale}/${timeZone}`,
      ),
    }
    const pipes = pipesFor(app, { locale: 'sw-KE', timeZone: 'Africa/Nairobi' })
    expect(pipes.where!('x')).toBe('x@sw-KE/Africa/Nairobi')
    expect(pipes.uppercase!('a')).toBe('A')
    expect(safeHtml('<b>')).toBeInstanceOf(SafeHtml)
  })

  it('readPipeExports', () => {
    const ok = readPipeExports(
      [
        "import { x } from './x'",
        'export const a = (v: string) => v',
        'export function b(v: number) { return { v } }',
        "const s = 'export const nope = 1'",
        '// export const nope2 = 1',
        'const c = 1, d = 2',
        'export { c, d as e }',
        'export type T = string',
        'export interface I { x: 1 }',
      ].join('\n'),
      'pipes.ts',
    )
    expect(ok.diagnostics).toEqual([])
    expect(ok.names).toEqual(['a', 'b', 'c', 'e'])
    for (const bad of [
      "export * from './x'",
      'export default {}',
      "export { f } from './x'",
      'export const date = (v: unknown) => v',
      'export async function later() {}',
      'export class K {}',
    ]) {
      expect(readPipeExports(bad, 'pipes.ts').diagnostics.length, bad).toBeGreaterThan(0)
    }
  })
})
