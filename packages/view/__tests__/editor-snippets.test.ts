/** The VS Code extension's `.kick` snippets, expanded with their defaults, pass the check. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check } from '../src/check/check'
import type { Project } from '../src/check/project'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

const file = resolve(import.meta.dirname, '../../vscode-extension/snippets/kick.json')
const snippets: Record<string, { body: string[] }> = JSON.parse(readFileSync(file, 'utf8'))

/** `${1:default}` → default, a repeated `$1` → the same default, `\$` → `$`. */
function expand(body: string[]): string {
  const defaults = new Map<string, string>()
  let src = body.join('\n')
  const placeholder = /\$\{(\d+):([^${}]*)\}/g
  // Innermost first, so `${3:$2}` resolves once `$2` has its default.
  while (src.includes('${'))
    src = src
      .replace(/(?<!\\)\$(\d+)/g, (m, n) => defaults.get(n) ?? m)
      .replace(placeholder, (_, n, d) => (defaults.set(n, d), d))
  return src.replace(/(?<!\\)\$(\d+)/g, (_, n) => defaults.get(n) ?? '').replace(/\\\$/g, '$')
}

const NAMES: Record<string, string> = {
  Layout: 'layouts/main',
  Component: 'components/item-card',
  'Component with script': 'components/widget',
}

const templates = new Map(
  Object.entries(snippets).map(([label, s]) => {
    const name = NAMES[label] ?? `pages/${label.toLowerCase().replace(/\W+/g, '-')}`
    return [name, parse(expand(s.body), `${name}.kick`).ast]
  }),
)
const project: Project = { templates, pipes: new Set(BUILTIN_PIPES), componentsDir: 'components' }

describe('vscode-extension/snippets/kick.json', () => {
  for (const name of templates.keys()) {
    it(`${name} checks without diagnostics`, () => {
      expect(check(name, project).diagnostics.map((d) => d.message)).toEqual([])
    })
  }
})
