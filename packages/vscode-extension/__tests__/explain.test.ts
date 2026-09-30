import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { explainArgs, findCliBin, formatExplanation } from '../src/commands/explain'

describe('explainArgs', () => {
  it('passes the message as one --message= element, whatever it contains', () => {
    const msg = `-v "quoted" $(rm -rf ~) 'x'\nsecond line`
    const args = explainArgs('/p/bin.js', msg)
    expect(args).toEqual(['/p/bin.js', 'explain', '--json', `--message=${msg}`])
  })
})

describe('findCliBin', () => {
  it('walks up from a nested folder to the installed CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'kick-explain-'))
    const cliDir = join(root, 'node_modules', '@forinda', 'kickjs-cli')
    mkdirSync(cliDir, { recursive: true })
    writeFileSync(join(cliDir, 'bin.js'), '')
    const nested = join(root, 'apps', 'api')
    mkdirSync(nested, { recursive: true })

    expect(findCliBin(nested)).toBe(join(cliDir, 'bin.js'))
  })

  it('returns undefined when the CLI is not installed', () => {
    const root = mkdtempSync(join(tmpdir(), 'kick-explain-none-'))
    expect(findCliBin(root)).toBeUndefined()
  })
})

describe('formatExplanation', () => {
  it('renders a matched diagnosis with fix, code, and docs', () => {
    const md = formatExplanation('config.get returned undefined', {
      matched: true,
      confidence: 90,
      diagnosis: {
        title: 'Env schema not loaded',
        explanation: 'Why text',
        fix: 'Fix text',
        codeAfter: "import './env'",
        docs: 'https://kickjs.app/guide/configuration',
      },
    })
    expect(md).toContain('# Env schema not loaded')
    expect(md).toContain('> config.get returned undefined')
    expect(md).toContain('_Confidence: 90%_')
    expect(md).toContain('## Fix\n\nFix text')
    expect(md).toContain("```ts\nimport './env'\n```")
    expect(md).toContain('[Read more](https://kickjs.app/guide/configuration)')
  })

  it('renders the no-match case', () => {
    const md = formatExplanation('weird\nerror', { matched: false })
    expect(md).toContain('# No known cause')
    expect(md).toContain('> weird\n> error')
  })
})
