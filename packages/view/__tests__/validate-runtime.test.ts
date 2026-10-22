// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { VALIDATE_RUNTIME } from '../src/validate-runtime'

beforeAll(() => {
  // The served script, run once as the browser would.
  new Function(VALIDATE_RUNTIME)()
})

beforeEach(() => {
  document.body.innerHTML = ''
})

/** A form with one field and its error spot. */
function form(
  field: string,
  rules: unknown[],
): { input: HTMLInputElement; spot: HTMLElement; form: HTMLFormElement } {
  document.body.innerHTML = `<form>${field.replace('RULES', JSON.stringify(rules).replace(/"/g, '&quot;'))}<span data-kick-error="f" hidden></span><button>Go</button></form>`
  return {
    input: document.querySelector('[name="f"]') as HTMLInputElement,
    spot: document.querySelector('[data-kick-error="f"]') as HTMLElement,
    form: document.querySelector('form') as HTMLFormElement,
  }
}

const blur = (el: HTMLElement) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
function check(
  rules: unknown[],
  value: string,
  field = '<input name="f" data-kick-validate="RULES">',
) {
  const f = form(field, rules)
  f.input.value = value
  blur(f.input)
  return f.spot.hidden ? '' : f.spot.textContent
}

describe('validator runtime', () => {
  it('required on blur', () => {
    expect(check([['required']], '')).toBe('This field is required')
    expect(check([['required']], 'x')).toBe('')
  })
  it('optional empty passes', () => {
    expect(check([['email'], ['minLength', 3]], '')).toBe('')
  })
  it('minLength counts characters', () => {
    expect(check([['minLength', 3]], '漢字')).toBe('Use at least 3 characters')
    expect(check([['minLength', 3]], '漢字字')).toBe('')
    expect(check([['maxLength', 2]], 'abc')).toBe('Use at most 2 characters')
  })
  it('min/max compare numbers', () => {
    expect(check([['min', 10]], '9')).toBe('Enter 10 or more')
    expect(check([['min', 10]], '10')).toBe('')
    expect(check([['max', 5]], '12')).toBe('Enter 5 or less')
    expect(check([['min', 1]], 'abc')).toBe('Enter 1 or more')
  })
  it('email and url', () => {
    expect(check([['email']], 'a@b')).toBe('Enter a valid email address')
    expect(check([['email']], 'a@b.co')).toBe('')
    expect(check([['url']], 'not a url')).toBe('Enter a valid URL')
    expect(check([['url']], 'javascript:alert(1)')).toBe('Enter a valid URL')
    expect(check([['url']], 'https://kickjs.app/x')).toBe('')
  })
  it('pattern matches the whole value', () => {
    expect(check([['pattern', '[a-z]+']], 'abc1')).toBe('Enter a value in the expected format')
    expect(check([['pattern', '[a-z]+']], 'abc')).toBe('')
  })
  it('in', () => {
    expect(check([['in', 'a, b']], 'c')).toBe('Choose one of: a, b')
    expect(check([['in', 'a, b']], 'b')).toBe('')
  })
  it('invalid submit is stopped and focuses the first field', () => {
    const f = form('<input name="f" data-kick-validate="RULES">', [['required']])
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true })
    f.form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(f.input)
    expect(f.spot.textContent).toBe('This field is required')
    expect(f.form.noValidate).toBe(true)
  })
  it('valid submit goes through', () => {
    const f = form('<input name="f" data-kick-validate="RULES">', [['required']])
    f.input.value = 'ok'
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true })
    f.form.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
  it('a server error spot is cleared when the field becomes valid', () => {
    const f = form('<input name="f" data-kick-validate="RULES">', [['required']])
    f.spot.hidden = false
    f.spot.textContent = 'Taken'
    f.input.value = 'new'
    blur(f.input)
    expect(f.spot.hidden).toBe(true)
    expect(f.spot.textContent).toBe('')
  })
  it('re-checks as you type once shown, and fields added later work too', () => {
    const f = form('<input name="f" data-kick-validate="RULES">', [['minLength', 2]])
    f.input.value = 'a'
    blur(f.input)
    expect(f.spot.hidden).toBe(false)
    f.input.value = 'ab'
    f.input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(f.spot.hidden).toBe(true)
  })
})
