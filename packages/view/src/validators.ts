/**
 * Browser validators for `validate="required | minLength:3"` on a form field:
 * the rules the check accepts, their arguments and default messages. The
 * check turns a field's `validate` into rule data; the validator script
 * (`./validate-runtime`) runs it in the browser.
 */

type Arg = 'number' | 'string'

export const VALIDATORS: Record<string, { args: Arg[]; message: string }> = {
  required: { args: [], message: 'This field is required' },
  email: { args: [], message: 'Enter a valid email address' },
  url: { args: [], message: 'Enter a valid URL' },
  minLength: { args: ['number'], message: 'Use at least {0} characters' },
  maxLength: { args: ['number'], message: 'Use at most {0} characters' },
  min: { args: ['number'], message: 'Enter {0} or more' },
  max: { args: ['number'], message: 'Enter {0} or less' },
  pattern: { args: ['string'], message: 'Enter a value in the expected format' },
  in: { args: ['string'], message: 'Choose one of: {0}' },
}

export type Rule = [string, ...Array<string | number>]

/** `s` split on `sep` outside single or double quotes. */
function split(s: string, sep: string): string[] {
  const out: string[] = []
  let quote = ''
  let at = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === "'" || c === '"') quote = c
    else if (c === sep) {
      out.push(s.slice(at, i))
      at = i + 1
    }
  }
  out.push(s.slice(at))
  return out.map((p) => p.trim())
}

/** `required | minLength:3 | pattern:'^[a-z]+$'` → rule data, or what's wrong with it. */
export function parseValidate(src: string): { rules: Rule[] } | { error: string } {
  const rules: Rule[] = []
  for (const part of split(src, '|')) {
    if (!part) return { error: 'empty validator in validate' }
    const [name, ...raw] = split(part, ':')
    const spec = VALIDATORS[name!]
    if (!spec) return { error: `unknown validator '${name}'` }
    if (raw.length !== spec.args.length)
      return {
        error: `${name} takes ${spec.args.length} argument${spec.args.length === 1 ? '' : 's'}`,
      }
    const args: Array<string | number> = []
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i]!
      if (spec.args[i] === 'number') {
        if (!/^-?\d+(\.\d+)?$/.test(a)) return { error: `${name} takes a number` }
        args.push(Number(a))
      } else {
        const m = /^(['"])([\s\S]*)\1$/.exec(a)
        if (!m) return { error: `${name} takes a quoted string` }
        args.push(m[2]!.replace(/\\(.)/g, '$1'))
      }
    }
    if (name === 'pattern') {
      try {
        RegExp(args[0] as string) // throws on a bad pattern
      } catch {
        return { error: `pattern '${args[0]}' isn't a valid regular expression` }
      }
    }
    rules.push([name!, ...args])
  }
  return { rules }
}
