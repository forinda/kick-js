/**
 * Attributes whose value is a URL a browser may navigate to, load or run
 * (spec §4). Their assembled value is scheme-checked when rendered.
 */
export const URL_ATTRS: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'cite',
  'background',
  'ping',
  'xlink:href',
])

export function isUrlAttr(tag: string, attr: string): boolean {
  const name = attr.toLowerCase()
  return URL_ATTRS.has(name) || (name === 'data' && tag.toLowerCase() === 'object')
}
