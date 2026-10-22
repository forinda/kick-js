/**
 * Parser and checker never throw: 5,000 seeded mutations of a corpus of
 * templates, each parsed and checked. A crash here is a bug; diagnostics are
 * the expected answer to broken input.
 */
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

const CORPUS = [
  '<h1>{{ user.name | titlecase }}</h1>',
  "@layout('layouts/main')\n@slot('head') {<title>{{ t }}</title>}\n<p>x</p>",
  '@if (a; as b) { {{ b }} } @else if (c) { y } @else { z }',
  '@for ([k, v] of m; track k; let i = $index) { <li [class.on]="i == 0">{{ k }}={{ v }}</li> } @empty { none }',
  "@switch (s) { @case ('a') { A } @default { D } }",
  '@let total = a + b;<b [title]="total">{{ total | number:\'1.0-2\' }}</b>',
  '<a href="/u/{{ id }}?q={{ q | url }}" [style.width.px]="w">x</a>',
  '<script type="application/json">{{ data | json }}</script>',
  '@verbatim { {{ vue }} @click }',
  '<svg><use xlink:href="#i"/><foreignObject><textarea>{{ t }}</textarea></foreignObject></svg>',
  '<x-card [user]="u" compact class="c">@slot(\'foot\') { f } body</x-card>',
  '{{-- c --}}<!-- html --><pre>  @if (x) { y }  </pre>',
]
const NOISE = '{}@()<>"\'|$\n[]/:;.?!=-'

/** A small LCG, so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

function mutate(src: string, rand: () => number): string {
  let out = src
  const edits = 1 + Math.floor(rand() * 4)
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(rand() * (out.length + 1))
    const op = rand()
    if (op < 0.4) out = out.slice(0, at) + NOISE[Math.floor(rand() * NOISE.length)] + out.slice(at)
    else if (op < 0.7) out = out.slice(0, at) + out.slice(at + 1 + Math.floor(rand() * 3))
    else
      out =
        out.slice(0, at) +
        out.slice(at, at + 1 + Math.floor(rand() * 6)).repeat(2) +
        out.slice(at + 1)
  }
  return out
}

describe('fuzz', () => {
  it('parse and check never throw', () => {
    const rand = rng(20261022)
    const card = parse(
      '@input user\n@input compact = false\n<div><slot /><slot name="foot" /></div>',
      'c.kick',
    ).ast
    const main = parse('<main><slot name="head" /><slot /></main>', 'm.kick').ast
    for (let n = 0; n < 5000; n++) {
      const src = mutate(CORPUS[n % CORPUS.length]!, rand)
      let result: ReturnType<typeof check> | undefined
      try {
        const parsed = parse(src, 'p.kick')
        expect(Array.isArray(parsed.diagnostics)).toBe(true)
        result = check('page', {
          templates: new Map([
            ['page', parsed.ast],
            ['components/x-card', card],
            ['layouts/main', main],
          ]),
          pipes: new Set(BUILTIN_PIPES),
          componentsDir: 'components',
        })
      } catch (e) {
        throw new Error(`crashed on mutation #${n}: ${JSON.stringify(src)}`, { cause: e })
      }
      expect(result.template !== undefined || result.diagnostics.length > 0).toBe(true)
    }
  })
})
