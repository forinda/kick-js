/**
 * The spec's benchmark page — a layout, three components, a 100-row loop
 * and pipes — rendered by `.kick` and by equivalent ejs. Target: `.kick`
 * within 1.5× of ejs. Run: `pnpm --filter @forinda/kickjs-view bench` (not part of `test`:
 * timings on shared CI machines are too noisy to gate on).
 */
import ejs from 'ejs'
import { expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { render, type RenderEnv } from '../src/render/render'
import { builtinPipes } from '../src/pipes/builtins'
import { layoutResolver } from '../src/check/project'

const KICK: Record<string, string> = {
  page: `@slot('head') {<title>{{ title }}</title>}
<site-header [user]="user" />
<table>
@for (row of rows; let i = $index) {
  <tr [class.odd]="i % 1 == 1"><td>{{ i + 1 }}</td><td>{{ row.name | titlecase }}</td><td>{{ row.price | number:'1.2-2' }}</td><td>@if (row.stock > 0) {in stock} @else {sold out}</td></tr>
}
</table>
<site-card [title]="title">{{ blurb }}</site-card>
<site-footer [year]="year" />`,
  'layouts/main':
    '<!doctype html><html><head><slot name="head" /></head><body><main><slot /></main></body></html>',
  'components/site-header':
    '@input user\n<header><a href="/">Home</a> <span>{{ user.name | uppercase }}</span></header>',
  'components/site-card':
    '@input title\n<section class="card"><h2>{{ title }}</h2><slot /></section>',
  'components/site-footer': '@input year\n<footer>&copy; {{ year }}</footer>',
}
// `%` isn't in the language; the odd class uses $odd instead.
KICK.page = KICK.page!.replace('[class.odd]="i % 1 == 1"', '[class.odd]="$odd"')

const EJS_PAGE = `<!doctype html><html><head><title><%= title %></title></head><body><main>
<header><a href="/">Home</a> <span><%= user.name.toUpperCase() %></span></header>
<table>
<% rows.forEach(function (row, i) { %>
  <tr<% if (i % 2 === 1) { %> class="odd"<% } %>><td><%= i + 1 %></td><td><%= titlecase(row.name) %></td><td><%= fmt.format(row.price) %></td><td><% if (row.stock > 0) { %>in stock<% } else { %>sold out<% } %></td></tr>
<% }) %>
</table>
<section class="card"><h2><%= title %></h2><%= blurb %></section>
<footer>&copy; <%= year %></footer>
</main></body></html>`

const data = {
  title: 'Products',
  blurb: 'Fresh from verified sellers <today>',
  year: 2026,
  user: { name: 'ada lovelace' },
  rows: Array.from({ length: 100 }, (_, i) => ({
    name: `item number ${i}`,
    price: i * 10.5,
    stock: i % 3,
  })),
}

const project = {
  templates: new Map(Object.entries(KICK).map(([n, s]) => [n, parse(s, `${n}.kick`).ast])),
  pipes: new Set(Object.keys(builtinPipes({ locale: 'en-US', timeZone: 'UTC' }))),
  componentsDir: 'components',
  layouts: 'layouts/main',
}
const checked = new Map<string, ReturnType<typeof check>['template']>()
const resolve = (n: string) => {
  if (!checked.has(n)) checked.set(n, check(n, project).template)
  return checked.get(n)!
}
const env: RenderEnv = {
  locale: 'en-US',
  timeZone: 'UTC',
  strict: false,
  pipes: builtinPipes({ locale: 'en-US', timeZone: 'UTC' }),
  warn: () => {},
  resolve,
  layoutFor: layoutResolver('layouts/main'),
}
const page = resolve('page')

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const titlecase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
const ejsPage = ejs.compile(EJS_PAGE)

/** Mean ms per call over `n` calls, after a warm-up. */
function time(fn: () => unknown, n = 2000): number {
  for (let i = 0; i < 200; i++) fn()
  const start = performance.now()
  for (let i = 0; i < n; i++) fn()
  return (performance.now() - start) / n
}

it('renders the benchmark page within 1.5× of ejs', () => {
  // Same output shape, so the comparison is fair.
  expect(render(page, data, env)).toContain('<td>Item Number 99</td>')
  const kick = time(() => render(page, data, env))
  const e = time(() => ejsPage({ ...data, fmt, titlecase }))
  console.log(
    `.kick ${kick.toFixed(4)} ms · ejs ${e.toFixed(4)} ms · ratio ${(kick / e).toFixed(2)}×`,
  )
  expect(kick / e).toBeLessThanOrEqual(1.5)
})
