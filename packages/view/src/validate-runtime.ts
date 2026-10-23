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

  /** A field's value; for a radio or checkbox, its group's: any checked one with the same name. */
  const valueOf = (el: El): string => {
    if (el.type !== 'checkbox' && el.type !== 'radio') return String(el.value ?? '')
    for (const other of (el.form || doc).querySelectorAll('input'))
      if (
        (other.type === 'checkbox' || other.type === 'radio') &&
        other.name === el.name &&
        other.checked
      )
        return String(other.value || 'on')
    return ''
  }

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
      // The app's own (validators.ts), registered by its script: a message string, or it passes.
      if (!Object.hasOwn(messages, name)) {
        const fn = (globalThis as { __kickValidators?: Record<string, unknown> })
          .__kickValidators?.[name]
        if (typeof fn !== 'function') continue
        try {
          const out = fn(value, ...args, el.form)
          if (typeof out === 'string' && out) return out
        } catch (err) {
          // One broken validator mustn't block the form.
          console.error(`[kick/view] validator '${name}' threw`, err)
        }
        continue
      }
      const n = Number(value)
      let ok = true
      if (name === 'email') ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      else if (name === 'url') {
        try {
          ok = /^https?:$/.test(new URL(value).protocol)
        } catch {
          ok = false
        }
        // UTF-16 units, as server schemas count: never refuse what the server accepts.
      } else if (name === 'minLength') ok = value.length >= Number(args[0])
      else if (name === 'maxLength') ok = value.length <= Number(args[0])
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

  let ids = 0

  /** Check `el`, show or clear its message; true when it passes. */
  function run(el: El): boolean {
    const msg = message(el)
    el.setCustomValidity?.(msg)
    el.setAttribute('data-kick-checked', '')
    const spot = spotFor(el)
    if (spot) {
      spot.textContent = msg
      spot.hidden = msg === ''
      // Screen readers read the message with the field.
      if (!spot.id) spot.id = `kick-error-${++ids}`
      const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      if (!described.includes(spot.id))
        el.setAttribute('aria-describedby', [...described, spot.id].join(' '))
    }
    if (msg) el.setAttribute('aria-invalid', 'true')
    else el.removeAttribute('aria-invalid')
    return msg === ''
  }

  const field = (t: El): El => (t && t.matches && t.matches('[data-kick-validate]') ? t : null)

  // The browser's own bubbles would stop a submit before ours runs.
  const quiet = () => {
    for (const el of doc.querySelectorAll('[data-kick-validate]'))
      if (el.form) el.form.noValidate = true
  }
  quiet()
  // Forms swapped in later (htmx, Turbo) get the same treatment before a submit.
  const Observer = (globalThis as any).MutationObserver
  if (Observer) new Observer(quiet).observe(doc.documentElement, { childList: true, subtree: true })
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
      // A `formnovalidate` button ("Save draft") submits without checks.
      if (e.submitter?.formNoValidate) return
      const form = e.target
      const fields = form.querySelectorAll('[data-kick-validate]')
      // Forms without validate fields are the browser's to check.
      if (!fields.length) return
      form.noValidate = true
      let first: El = null
      for (const el of fields) if (!run(el) && !first) first = el
      if (first) {
        e.preventDefault()
        first.focus()
        return
      }
      // The browser's own checks (a plain `required`, `type=email`) still apply.
      if (form.reportValidity && !form.reportValidity()) e.preventDefault()
    },
    true,
  )
}

/**
 * Appended to `validators.ts` when it's served without a bundler: the module
 * imports its own namespace and registers every export for the validator script.
 */
export const VALIDATORS_REGISTER =
  '\nimport(import.meta.url).then((m) => Object.assign((globalThis.__kickValidators ??= {}), m))\n'

const MESSAGES = Object.fromEntries(Object.entries(VALIDATORS).map(([k, v]) => [k, v.message]))

/** The script's source: the compiled function, called with the messages as JSON. */
export const VALIDATE_RUNTIME = `(${runtime.toString()})(${JSON.stringify(MESSAGES)}, document);\n`
