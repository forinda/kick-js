import { describe, expect, it } from 'vitest'
import { kickLanguagePlugin } from '../src/language-plugin'
import { renderCompletions, renderDefinition, renderDiagnostics } from '../src/plugin/render-calls'
import { cursor, ROOT, uri, workspaceOf } from './helpers'
import { URI } from 'vscode-uri'

async function app() {
  return workspaceOf({
    'src/views/home.kick': '<p></p>',
    'src/views/users/show.kick': '<p></p>',
    'src/views/layouts/main.kick': '<slot />',
    'src/views/components/user-card.kick': '<div></div>',
  })
}

describe('render calls in TypeScript', () => {
  it('completes template names, components left out', async () => {
    const ws = await app()
    const { text, offset } = cursor("  await ctx.render('us§")
    const items = renderCompletions(ws, text, offset)!
    expect(items.map((i) => i.label).toSorted()).toEqual(['home', 'layouts/main', 'users/show'])
    // The typed part is replaced.
    expect(items[0]!.textEdit).toMatchObject({
      range: { start: { line: 0, character: 20 }, end: { line: 0, character: 22 } },
    })
    expect(renderCompletions(ws, ...pos(cursor('views.render("§')))).toHaveLength(3)
    expect(renderCompletions(ws, ...pos(cursor("ctx.json('§")))).toBeUndefined()
  })
  it('goes to the template', async () => {
    const ws = await app()
    const { text, offset } = cursor("ctx.render('users/sh§ow', { user })")
    expect(renderDefinition(ws, text, offset)).toMatchObject({ targetUri: uri('users/show') })
    expect(renderDefinition(ws, text, 0)).toBeNull()
  })
  it("warns about templates that don't exist", async () => {
    const ws = await app()
    const text = "ctx.render('home')\nctx.render('users/missing', {})\nctx.render(`users/${id}`)"
    expect(renderDiagnostics(ws, text)).toEqual([
      expect.objectContaining({
        message: "template 'users/missing' not found",
        severity: 2,
        range: { start: { line: 1, character: 12 }, end: { line: 1, character: 25 } },
      }),
    ])
  })
})

describe('language plugin', () => {
  it('gives TS and JS files a code only the kick plugin reads', () => {
    const snap = {
      getText: () => "ctx.render('x')",
      getLength: () => 15,
      getChangeRange: () => undefined,
    }
    const code = kickLanguagePlugin.createVirtualCode!(
      URI.file(`${ROOT}/src/a.ts`),
      'typescript',
      snap,
      {} as never,
    )
    expect(code?.languageId).toBe('kick-render')
    expect(code?.embeddedCodes ?? []).toEqual([])
    expect(
      kickLanguagePlugin.createVirtualCode!(URI.file(`${ROOT}/a.css`), 'css', snap, {} as never),
    ).toBeUndefined()
  })
})

/** `[text, offset]` from a `cursor` result, for spreading. */
function pos(c: { text: string; offset: number }): [string, number] {
  return [c.text, c.offset]
}
