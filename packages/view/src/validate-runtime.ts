/**
 * The validator script: checks `[data-kick-validate]` fields in the browser
 * and writes each message into the field's `[data-kick-error]` spot — the
 * same spot `@error` renders the server's message into. Served as plain JS
 * (`kick-validate.<hash>.js`): the function below is compiled with the
 * package and sent as its source, called with the message table as data.
 * No `eval`: rules are JSON, and a `pattern` is a regular expression's source.
 */
import { VALIDATORS } from './validators'

type Rule = [string, ...Array<string | number>]
// Typed loosely: the package compiles without the DOM library.
type El = any

function runtime(messages: Record<string, string>, doc: any): void {
  const say = (name: string, args: Array<string | number>) =>
    messages[name]!.replace(/\{(\d+)\}/g, (_m: string, i: string) => String(args[Number(i)]))

  const valueOf = (el: El): string =>
    el.type === 'checkbox' || el.type === 'radio'
      ? el.checked
        ? String(el.value || 'on')
        : ''
      : String(el.value ?? '')

  /** The first failing rule's message, or ''. */
  function message(el: El): string {
    let rules: Rule[]
    try {
      rules = JSON.parse(el.getAttribute('data-kick-validate') || '[]')
    } catch {
      return ''
    }
    const value = valueOf(el)
    for (const [name, ...args] of rules) {
      if (name === 'required') {
        if (value.trim() === '') return say(name, args)
        continue
      }
      // Optional and empty: nothing else applies.
      if (value === '') continue
      const n = Number(value)
      let ok = true
      if (name === 'email') ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      else if (name === 'url') {
        try {
          ok = /^https?:$/.test(new URL(value).protocol)
        } catch {
          ok = false
        }
      } else if (name === 'minLength') ok = [...value].length >= Number(args[0])
      else if (name === 'maxLength') ok = [...value].length <= Number(args[0])
      else if (name === 'min') ok = !Number.isNaN(n) && n >= Number(args[0])
      else if (name === 'max') ok = !Number.isNaN(n) && n <= Number(args[0])
      else if (name === 'pattern') {
        try {
          ok = new RegExp(`^(?:${args[0]})$`).test(value)
        } catch {
          ok = true
        }
      } else if (name === 'in')
        ok = String(args[0])
          .split(',')
          .map((s) => s.trim())
          .includes(value)
      if (!ok) return say(name, args)
    }
    return ''
  }

  const spotFor = (el: El): El => {
    const name = el.getAttribute('name')
    if (!name) return null
    const root = el.form || doc
    for (const s of root.querySelectorAll('[data-kick-error]'))
      if (s.getAttribute('data-kick-error') === name) return s
    return null
  }

  /** Check `el`, show or clear its message; true when it passes. */
  function run(el: El): boolean {
    const msg = message(el)
    el.setCustomValidity?.(msg)
    el.setAttribute('data-kick-checked', '')
    const spot = spotFor(el)
    if (spot) {
      spot.textContent = msg
      spot.hidden = msg === ''
    }
    return msg === ''
  }

  const field = (t: El): El => (t && t.matches && t.matches('[data-kick-validate]') ? t : null)

  // The browser's own bubbles would stop a submit before ours runs.
  const quiet = () => {
    for (const el of doc.querySelectorAll('[data-kick-validate]'))
      if (el.form) el.form.noValidate = true
  }
  quiet()
  doc.addEventListener('focusin', (e: El) => {
    const el = field(e.target)
    if (el?.form) el.form.noValidate = true
  })
  doc.addEventListener('focusout', (e: El) => {
    const el = field(e.target)
    if (el) run(el)
  })
  doc.addEventListener('input', (e: El) => {
    const el = field(e.target)
    // Once a field has been checked, it re-checks as it changes.
    if (el?.hasAttribute('data-kick-checked')) run(el)
  })
  doc.addEventListener(
    'submit',
    (e: El) => {
      const form = e.target
      form.noValidate = true
      let first: El = null
      for (const el of form.querySelectorAll('[data-kick-validate]'))
        if (!run(el) && !first) first = el
      if (first) {
        e.preventDefault()
        first.focus()
      }
    },
    true,
  )
}

const MESSAGES = Object.fromEntries(Object.entries(VALIDATORS).map(([k, v]) => [k, v.message]))

/** The script's source: the compiled function, called with the messages as JSON. */
export const VALIDATE_RUNTIME = `(${runtime.toString()})(${JSON.stringify(MESSAGES)}, document);\n`
