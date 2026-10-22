/**
 * Attempts to get script or markup out of a template. Each must either fail
 * to compile, or render without the payload.
 */
import { describe, expect, it, vi } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { render } from '../src/render/render'
import { builtinPipes } from '../src/pipes/builtins'
import { SafeHtml } from '../src/render/safe'

const pipes = {
  ...builtinPipes({ locale: 'en-US', timeZone: 'UTC' }),
  trusted: (v: unknown) => new SafeHtml(String(v)),
}

/** The rendered HTML, or `null` when the template didn't compile. */
function attempt(src: string, data: object): string | null {
  const parsed = parse(src, 'page.kick')
  if (parsed.diagnostics.some((d) => d.severity === 'error')) return null
  const r = check('page', {
    templates: new Map([['page', parsed.ast]]),
    pipes: new Set(Object.keys(pipes)),
    componentsDir: 'components',
  })
  if (!r.template) return null
  return render(r.template, data, {
    locale: 'en-US',
    timeZone: 'UTC',
    strict: false,
    pipes,
    warn: vi.fn(),
    resolve: () => r.template!,
  })
}

const JS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  ' \u0001javascript:alert(1)',
  'vbscript:x',
  'data:text/html,<script>',
]
const URL_ATTRS = [
  ['a', 'href'],
  ['img', 'src'],
  ['form', 'action'],
  ['button', 'formaction'],
  ['video', 'poster'],
  ['blockquote', 'cite'],
  ['a', 'ping'],
  ['object', 'data'],
  ['base', 'href'],
  ['link', 'href'],
  ['iframe', 'src'],
  ['embed', 'src'],
]

describe('safety corpus', () => {
  it('no prototype or function access', () => {
    const data = { x: {}, f: () => 'called', s: 'str' }
    for (const src of [
      '{{ x.constructor }}',
      "{{ x['constructor'] }}",
      "{{ x['__proto__'] }}",
      '{{ s.constructor }}',
      '{{ f }}',
      '{{ x.toString }}',
      "{{ x['__lookupGetter__'] }}",
      '{{ x.hasOwnProperty }}',
      '{{ constructor }}',
    ]) {
      const out = attempt(src, data)
      expect(out === null || out === '', src).toBe(true)
    }
  })

  it('no script URL in any URL attribute', () => {
    for (const [tag, attr] of URL_ATTRS) {
      for (const js of JS) {
        for (const src of [
          `<${tag} ${attr}="{{ u }}">`,
          `<${tag} [${attr}]="u">`,
          `<${tag} ${attr}="{{ a }}{{ b }}">`,
        ]) {
          const out = attempt(src, { u: js, a: js.slice(0, 4), b: js.slice(4) })
          expect(
            out === null || !/script:|data:/i.test(out.replace(/\s/g, '')),
            `${src} ${JSON.stringify(js)}`,
          ).toBe(true)
        }
      }
    }
    const svg = attempt('<svg><a href="{{ u }}" xlink:href="{{ u }}">x</a></svg>', {
      u: 'javascript:x',
    })
    expect(svg).not.toContain('javascript')
    const srcset = attempt('<img srcset="{{ s }}">', { s: 'a.png 1x, javascript:x 2x' })
    expect(srcset).not.toContain('javascript')
  })

  it('no breaking out of attributes, tags or elements', () => {
    const payload = '"><script>alert(1)</script>'
    for (const src of [
      '<p title="{{ x }}">t</p>',
      '<p [title]="x">t</p>',
      '<p [class.on]="x">t</p>',
      '<title>{{ x }}</title>',
      '<textarea>{{ x }}</textarea>',
      '<title>{{ x | trusted }}</title>',
      '<p>{{ x }}</p>',
      '<p [style.width]="x">t</p>',
    ]) {
      const out = attempt(src, { x: payload })
      expect(out === null || !out.includes('<script>'), src).toBe(true)
    }
  })

  it('no interpolation where escaping cannot help', () => {
    for (const src of [
      '<script>{{ x }}</script>',
      '<style>{{ x }}</style>',
      '<svg><script>{{ x }}</script></svg>',
      '<p onclick="{{ x }}">t</p>',
      '<p [onclick]="x">t</p>',
      '<p style="{{ x }}">t</p>',
      '<p class="{{ x }}">t</p>',
      '<iframe srcdoc="{{ x }}"></iframe>',
      '<meta http-equiv="refresh" content="{{ x }}">',
      '<!-- {{ x }} -->',
      '<a href="{{ x | raw }}">t</a>',
      '<p>{{ a ? (x | raw) : b }}</p>',
      '<{{ t }}>',
      '<p {{ a }}>t</p>',
      '<p title={{ x }}>t</p>',
      '<svg><set attributeName="href" to="{{ x }}" /></svg>',
    ]) {
      expect(attempt(src, { x: 'alert(1)', t: 'script', a: 1 }), src).toBeNull()
    }
  })

  it('JSON in a script cannot close it', () => {
    const out = attempt('<script type="application/json">{{ d | json }}</script>', {
      d: { s: '</script><script>alert(1)</script><!-- ' },
    })!
    expect(out.match(/<\/script>/g)).toHaveLength(1)
    expect(out).not.toContain('<!--')
  })
})
