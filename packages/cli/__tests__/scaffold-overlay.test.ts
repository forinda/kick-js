/**
 * Overlay scaffolding: layers are directories under `templates/`, rendered in
 * order into project paths. `_dot_` segment prefixes become dotfiles, so
 * `.gitignore` and friends survive npm publish.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { outputPath, renderLayers } from '../src/scaffold/overlay'

describe('outputPath', () => {
  it('turns a _dot_ prefix into a dot in any segment', () => {
    expect(outputPath('_dot_gitignore')).toBe('.gitignore')
    expect(outputPath('_dot_env.test.example')).toBe('.env.test.example')
    expect(outputPath('_dot_vscode/_dot_hidden/settings.json')).toBe(
      '.vscode/.hidden/settings.json',
    )
    expect(outputPath('src/not_dot_file.ts')).toBe('src/not_dot_file.ts')
  })
})

describe('renderLayers', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }

  it('renders layers in order, a later layer replacing an earlier file', () => {
    root = mkdtempSync(join(tmpdir(), 'kick-layers-'))
    write('one/files/src/a.ts', 'a from one')
    write('one/files/_dot_gitignore', 'dist/')
    write('two/files/src/a.ts', 'a from two')
    write('two/files/src/deep/b.ts', 'b')

    const files = renderLayers(['one', 'two'], root)
    expect(Object.fromEntries(files)).toEqual({
      '.gitignore': 'dist/',
      'src/a.ts': 'a from two',
      'src/deep/b.ts': 'b',
    })
  })

  it('fails on an unknown layer', () => {
    root = mkdtempSync(join(tmpdir(), 'kick-layers-'))
    expect(() => renderLayers(['nope'], root)).toThrow('Unknown scaffold layer "nope"')
  })
})

describe('the base layer', () => {
  it('holds the option-independent project files', () => {
    expect([...renderLayers(['base']).keys()].toSorted()).toEqual([
      '.editorconfig',
      '.env',
      '.env.example',
      '.env.test',
      '.env.test.example',
      '.gitattributes',
      '.gitignore',
      '.oxfmtrc.json',
      'src/modules/hello/hello.controller.ts',
      'src/modules/hello/hello.module.ts',
      'src/modules/hello/hello.service.ts',
      'src/modules/index.ts',
      'tsconfig.json',
      'vitest.config.ts',
    ])
  })
})
