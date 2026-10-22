import { describe, expect, it } from 'vitest'
import { URI } from 'vscode-uri'
import { KickVirtualCode, kickLanguagePlugin } from '../src/language-plugin'

const code = (src: string) => new KickVirtualCode(src)
const html = (src: string) => {
  const h = code(src).embeddedCodes.find((c) => c.id === 'html')!
  return h.snapshot.getText(0, h.snapshot.getLength())
}

describe('KickVirtualCode', () => {
  it('html is the source with template syntax blanked', () => {
    expect(html('<p>{{ a }}</p>')).toBe('<p>       </p>')
    expect(html('<a title="{{ t }}">x</a>')).toBe('<a title="       ">x</a>')
    expect(html('a{{-- c {{ x }} --}}b')).toBe(`a${' '.repeat(19)}b`)
  })

  it('block headers and closers are blank, bodies are kept', () => {
    expect(html('@if (a) {\n<b>x</b>\n}')).toBe('         \n<b>x</b>\n ')
    expect(html('@for (x of xs) {<i>{{ x }}</i>} @empty {<i>-</i>}')).toBe(
      `${' '.repeat(16)}<i>       </i>${' '.repeat(10)}<i>-</i> `,
    )
    expect(html("@layout('main')\n@let t = a + b;\n<p></p>")).toBe(
      `${' '.repeat(15)}\n${' '.repeat(15)}\n<p></p>`,
    )
    expect(html('@input user\n<p></p>')).toBe(`${' '.repeat(11)}\n<p></p>`)
  })

  it('text that is not template syntax stays', () => {
    expect(html('<p>mail hi@example.com { x }</p>')).toBe('<p>mail hi@example.com { x }</p>')
    expect(html('<b @click="go()">x</b>')).toBe('<b @click="go()">x</b>')
  })

  it('binding values are blank, names stay', () => {
    expect(html('<p [title]="a.b" [class.on]="x">y</p>')).toBe(
      '<p [title]="   " [class.on]=" ">y</p>',
    )
  })

  it('quoted ; and } stay inside @let and @verbatim, as the parser reads them', () => {
    const let_ = '@let t = "a; <b>";\n<i></i>'
    expect(html(let_)).toBe(`${' '.repeat(18)}\n<i></i>`)
    const verbatim = '@verbatim { "}" <b> }\n<i></i>'
    expect(html(verbatim)).toBe(`${' '.repeat(21)}\n<i></i>`)
  })
  it('verbatim blocks are blank', () => {
    expect(html('@verbatim { {{ v }} }<p></p>')).toBe(`${' '.repeat(21)}<p></p>`)
  })

  it('offsets map 1:1 outside template syntax', () => {
    const h = code('@if (a) {\n<b>x</b>\n}').embeddedCodes.find((c) => c.id === 'html')!
    const m = h.mappings.find(
      (x) => x.sourceOffsets[0]! <= 10 && 10 < x.sourceOffsets[0]! + x.lengths[0]!,
    )!
    expect(m.sourceOffsets[0]).toBe(m.generatedOffsets[0])
    // Blanked ranges are not mapped: nothing reported or completed inside them.
    expect(h.mappings.some((x) => x.sourceOffsets[0] === 0)).toBe(false)
  })

  it('styles and scripts are embedded', () => {
    const c = code(
      '<style>a{color:red}</style><script>go()</script><script type="application/json">{{ d | json }}</script>',
    )
    expect(c.embeddedCodes.map((e) => `${e.id}:${e.languageId}`)).toEqual([
      'html:html',
      'css_0:css',
      'js_0:javascript',
    ])
    const css = c.embeddedCodes[1]!
    expect(css.snapshot.getText(0, css.snapshot.getLength())).toBe('a{color:red}')
    expect(css.mappings[0]).toMatchObject({
      sourceOffsets: [7],
      generatedOffsets: [0],
      lengths: [12],
    })
  })

  it('a buffer that does not parse still yields html', () => {
    expect(html('<p>{{ a(')).toBe('<p>     ')
    expect(html('@if (a {')).toBe('        ')
  })

  it('a closing tag being typed', () => {
    expect(html('<p>x</')).toBe('<p>x</')
    expect(html('<p>x</ ')).toBe('<p>x</ ')
    expect(html('<p>x</>')).toBe('<p>x</>')
  })
})

describe('kickLanguagePlugin', () => {
  it('claims .kick files', () => {
    expect(kickLanguagePlugin.getLanguageId(URI.file('/a/b.kick'))).toBe('kick')
    expect(kickLanguagePlugin.getLanguageId(URI.file('/a/b.html'))).toBeUndefined()
    const snapshot = {
      getText: (s: number, e: number) => '<p></p>'.slice(s, e),
      getLength: () => 7,
      getChangeRange: () => undefined,
    }
    expect(
      kickLanguagePlugin.createVirtualCode!(URI.file('/a.kick'), 'kick', snapshot, {} as never),
    ).toBeInstanceOf(KickVirtualCode)
  })
})
