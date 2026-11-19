/**
 * What sits at the cursor — read lexically from the text before it, because
 * the buffer being typed in rarely parses. Decides which completions apply
 * and which names are in scope there.
 */
export type CursorContext =
  | { kind: 'keyword'; prefix: string }
  | { kind: 'pipe'; prefix: string }
  | { kind: 'validator'; prefix: string }
  | { kind: 'expr'; prefix: string; scope: string[] }
  | { kind: 'tag'; prefix: string }
  | { kind: 'attr'; tag: string; prefix: string }
  | { kind: 'template-name'; prefix: string }
  | { kind: 'slot-name'; prefix: string }
  | { kind: 'stack-name'; prefix: string }
  | { kind: 'snippet-name'; prefix: string }
  /** `@slot('row'; let …`: the names slot `slot` of component `tag` passes */
  | { kind: 'slot-let'; slot: string; tag?: string; prefix: string }
  /** inside `<component of="…"` */
  | { kind: 'component-tag'; prefix: string }
  | { kind: 'other' }

export const LOOP_VARS = ['$index', '$first', '$last', '$even', '$odd', '$count']

const IDENT = /[A-Za-z_$][\w$]*/

/** The end of `(`…`)` from `i` (at `(`), or -1 when it doesn't close before `stop`. */
function closeParen(s: string, i: number, stop: number): number {
  let depth = 0
  let quote = ''
  for (let j = i; j < stop; j++) {
    const c = s[j]!
    if (quote) {
      if (c === '\\') j++
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"') quote = c
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j + 1
  }
  return -1
}

/** Names a block header brings into its body. */
function headerNames(kw: string, header: string): string[] {
  if (kw === 'for') {
    const [head, ...rest] = header.split(';')
    const m = /^\s*(?:\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]|([\w$]+))\s+of\b/.exec(head ?? '')
    const names = m ? (m[3] ? [m[3]] : [m[1]!, m[2]!]) : []
    for (const part of rest) {
      const lets = /^\s*let\s+(.*)$/.exec(part)
      if (lets) for (const d of lets[1]!.split(',')) names.push(d.split('=')[0]!.trim())
    }
    return [...names.filter(Boolean), ...LOOP_VARS]
  }
  // `@error('field') { … }` gives its body the field's message.
  if (kw === 'error') return ['$message']
  if (kw === 'if' || kw === 'else if') {
    const as = /;\s*as\s+([\w$]+)/.exec(header)
    return as ? [as[1]!] : []
  }
  // `@snippet name(a, b = 1)`: its parameters.
  if (kw === 'snippet')
    return header
      .split(',')
      .map((p) => p.split('=')[0]!.trim())
      .filter(Boolean)
  // `@slot('row'; let a, b = c)`: the names it binds.
  if (kw === 'slot') {
    const lets = /;\s*let\s+(.*)$/s.exec(header)
    return lets
      ? lets[1]!
          .split(',')
          .map((d) => d.split('=')[0]!.trim())
          .filter(Boolean)
      : []
  }
  return []
}

/** Names in scope at `stop`: inputs, then each enclosing block's, outermost first. */
export function scopeAt(s: string, stop: number): string[] {
  const inputs: string[] = []
  const frames: string[][] = [[]]
  let i = 0
  while (i < stop) {
    const c = s[i]!
    if (c === '{' && s[i + 1] === '{') {
      const end = s.indexOf(s.startsWith('{{--', i) ? '--}}' : '}}', i + 2)
      if (end < 0 || end >= stop) break
      i = end + 2
      continue
    }
    if (c === '<') {
      const end = s.startsWith('<!--', i) ? s.indexOf('-->', i) : s.indexOf('>', i)
      if (end < 0 || end >= stop) break
      i = end + 1
      continue
    }
    if (c === '@' && !/[\w@.-]/.test(s[i - 1] ?? '')) {
      const m =
        /^@(else\s+if|for|if|switch|case|slot|error|fragment|push|snippet|else|empty|default|let|input)(?![\w$-])/.exec(
          s.slice(i, i + 16),
        )
      if (m) {
        const kw = m[1]!.replace(/\s+/g, ' ')
        let j = i + m[0].length
        if (kw === 'input') {
          const name = IDENT.exec(s.slice(j, j + 64))
          if (name) inputs.push(name[0])
          i = j
          continue
        }
        if (kw === 'let') {
          const name = /^\s+([\w$]+)\s*=/.exec(s.slice(j, j + 64))
          const semi = s.indexOf(';', j)
          if (name && semi >= 0 && semi < stop) frames.at(-1)!.push(name[1]!)
          i = semi >= 0 && semi < stop ? semi + 1 : stop
          continue
        }
        let header = ''
        while (j < stop && /\s/.test(s[j]!)) j++
        // `@snippet name(…)`: the name comes before the parameters.
        if (kw === 'snippet') {
          const name = /^[A-Za-z_$][\w$]*/.exec(s.slice(j, j + 64))
          if (name) j += name[0].length
          while (j < stop && /\s/.test(s[j]!)) j++
        }
        if (s[j] === '(') {
          const end = closeParen(s, j, stop)
          if (end < 0) break
          header = s.slice(j + 1, end - 1)
          j = end
        }
        while (j < stop && /\s/.test(s[j]!)) j++
        if (s[j] === '{') {
          frames.push(headerNames(kw, header))
          i = j + 1
          continue
        }
        i = j
        continue
      }
    }
    if (c === '}' && frames.length > 1) frames.pop()
    i++
  }
  return [...inputs, ...frames.flat()]
}

function exprContext(segment: string, s: string, offset: number): CursorContext {
  const pipe = /\|\s*([A-Za-z_$][\w$]*)?$/.exec(segment)
  if (pipe && !/\|\|\s*[\w$]*$/.test(segment)) return { kind: 'pipe', prefix: pipe[1] ?? '' }
  if (/\??\.\s*[\w$]*$/.test(segment)) return { kind: 'other' }
  const word = /([A-Za-z_$][\w$]*)?$/.exec(segment)!
  return { kind: 'expr', prefix: word[1] ?? '', scope: scopeAt(s, offset) }
}

export function cursorContext(s: string, offset: number): CursorContext {
  const before = s.slice(0, offset)

  // Inside {{ … }}
  const open = before.lastIndexOf('{{')
  if (open >= 0 && open > before.lastIndexOf('}}') && !before.startsWith('{{--', open)) {
    return exprContext(before.slice(open + 2), s, offset)
  }

  // @render na…
  const rnd = /@render\s+([\w$]*)$/.exec(before)
  if (rnd) return { kind: 'snippet-name', prefix: rnd[1]! }

  // @slot('row'; let a, …
  const slotLet =
    /@slot\s*\(\s*(?:['"]([^'"]*)['"]|default)\s*;\s*let\s+(?:[\w$]+\s*(?:=\s*[\w$]+\s*)?,\s*)*([\w$]*)$/.exec(
      before,
    )
  if (slotLet) {
    const tag = enclosingComponent(before)
    return {
      kind: 'slot-let',
      slot: slotLet[1] ?? '',
      prefix: slotLet[2]!,
      ...(tag ? { tag } : {}),
    }
  }

  // <component of="a b…
  const ofAttr = /<component\b[^>]*\bof\s*=\s*"([^"]*)$/.exec(before)
  if (ofAttr) return { kind: 'component-tag', prefix: ofAttr[1]!.split(/\s+/).at(-1)! }

  // @layout('… / @slot('… / @push('…
  const named = /@(layout|slot|push)\s*\(\s*['"]([^'"]*)$/.exec(before)
  if (named) {
    const kind = { layout: 'template-name', slot: 'slot-name', push: 'stack-name' } as const
    return { kind: kind[named[1] as keyof typeof kind], prefix: named[2]! }
  }

  // @let name = …
  const letExpr = /@let\s+[\w$]+\s*=\s*([^;\n]*)$/.exec(before)
  if (letExpr) return exprContext(letExpr[1]!, s, offset)

  // A block header that hasn't closed: @if (…, @for (…
  const header = /@(?:else\s+if|if|for|switch|case)\s*\(([^]*)$/.exec(before)
  if (header && closeParen(before, before.length - header[1]!.length - 1, before.length) < 0) {
    return exprContext(header[1]!, s, offset)
  }

  // Inside a tag
  const tag = /<([A-Za-z][\w:.-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(["'][^"']*)?$/.exec(before)
  if (tag && !before.endsWith('>')) {
    const [, name, attrs = '', openValue] = tag
    if (openValue !== undefined) {
      // In a binding's value: an expression.
      if (/\[[^\]]+\]\s*=\s*$/.test(attrs)) return exprContext(openValue.slice(1), s, offset)
      // `validate="required | min…`: a validator name, not one of its arguments.
      if (/\svalidate\s*=\s*$/i.test(attrs)) {
        const rule = /(?:^|\|)\s*([\w$]*)$/.exec(openValue.slice(1))
        return rule ? { kind: 'validator', prefix: rule[1]! } : { kind: 'other' }
      }
      return { kind: 'other' }
    }
    if (!attrs) return { kind: 'tag', prefix: name! }
    if (name!.includes('-')) {
      const attr = /\s\[?([\w-]*)$/.exec(attrs)
      if (attr) return { kind: 'attr', tag: name!.toLowerCase(), prefix: attr[1]! }
    }
    return { kind: 'other' }
  }

  // @keyword in text
  const kw = /(?<![\w@.-])@([A-Za-z]*)$/.exec(before)
  if (kw) return { kind: 'keyword', prefix: kw[1]! }

  return { kind: 'other' }
}

/** The name under the cursor (pipes, tags, template names) and its range. */
export function wordAt(s: string, offset: number): { word: string; start: number; end: number } {
  let start = offset
  let end = offset
  while (start > 0 && /[\w$/-]/.test(s[start - 1]!)) start--
  while (end < s.length && /[\w$/-]/.test(s[end]!)) end++
  return { word: s.slice(start, end), start, end }
}

/** The innermost component tag (one with a `-`) still open in `before`. */
function enclosingComponent(before: string): string | undefined {
  const open: string[] = []
  for (const m of before.matchAll(/<(\/?)([a-z][\w]*-[\w-]*)\b[^>]*?(\/?)>/gi)) {
    const tag = m[2]!.toLowerCase()
    if (m[1]) {
      const at = open.lastIndexOf(tag)
      if (at >= 0) open.splice(at)
    } else if (!m[3]) open.push(tag)
  }
  return open.at(-1)
}
