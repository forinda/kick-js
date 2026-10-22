/**
 * Decode the character references a browser would in attribute text: every
 * numeric one, and the named ones that matter for reading a URL's scheme or
 * for common text. Unknown names stay as written.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  Tab: '\t',
  NewLine: '\n',
  sol: '/',
  bsol: '\\',
  period: '.',
  comma: ',',
  semi: ';',
  equals: '=',
  quest: '?',
  num: '#',
  excl: '!',
  lpar: '(',
  rpar: ')',
  plus: '+',
  hyphen: '-',
  dash: '-',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(
    /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([A-Za-z][A-Za-z0-9]*));?/g,
    (m, hex, dec, name) => {
      if (hex !== undefined || dec !== undefined) {
        const code = parseInt(hex ?? dec, hex !== undefined ? 16 : 10)
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : '�'
      }
      return Object.hasOwn(NAMED, name) && m.endsWith(';') ? NAMED[name]! : m
    },
  )
}
