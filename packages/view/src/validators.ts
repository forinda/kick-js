/**
 * Browser validators for `validate="required | minLength:3"` on a form field:
 * the rules the check accepts, their arguments and default messages. The
 * check turns a field's `validate` into rule data; the validator script
 * (`./validate-runtime`) runs it in the browser.
 */

import type { Diagnostic } from './diagnostics'
import { readExportNames } from './pipes/read-exports'

type Arg = 'number' | 'string'

/** The component tag the app's validators are served under: `kick-validators.<hash>.js`. */
export const VALIDATORS_TAG = 'kick-validators'

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

/** The built-in validator names, for editors. */
export const BUILTIN_VALIDATORS = Object.keys(VALIDATORS)

export type Rule = [string, ...Array<string | number>]

/** The validators `validators.ts` exports, refusing the built-in names. */
export function readValidatorExports(
  source: string,
  file: string,
): { names: string[]; diagnostics: Diagnostic[] } {
  return readExportNames(source, file, Object.keys(VALIDATORS), 'validator')
}

/** A quoted string or a number, as validator arguments are written; undefined when it's neither. */
function argValue(a: string): string | number | undefined {
  if (/^-?\d+(\.\d+)?$/.test(a)) return Number(a)
  const m = /^(['"])([\s\S]*)\1$/.exec(a)
  // Only an escaped quote is unescaped: `\d` stays a regex escape.
  return m ? m[2]!.split(`\\${m[1]}`).join(m[1]!) : undefined
}

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

/**
 * `required | minLength:3 | pattern:'^[a-z]+$'` → rule data, or what's wrong
 * with it. `custom`: the app's validators, which take any numbers or quoted strings.
 */
export function parseValidate(
  src: string,
  custom?: ReadonlySet<string>,
): { rules: Rule[] } | { error: string } {
  const rules: Rule[] = []
  for (const part of split(src, '|')) {
    if (!part) return { error: 'empty validator in validate' }
    const [name, ...raw] = split(part, ':')
    if (!Object.hasOwn(VALIDATORS, name!) && custom?.has(name!)) {
      const args = raw.map(argValue)
      if (args.some((a) => a === undefined))
        return { error: `${name} takes numbers or quoted strings` }
      rules.push([name!, ...(args as Array<string | number>)])
      continue
    }
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
        // Only an escaped quote is unescaped: `\d` stays a regex escape.
        args.push(m[2]!.split(`\\${m[1]}`).join(m[1]!))
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
