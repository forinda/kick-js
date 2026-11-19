/** Template names with a view root prefix (`billing::invoices/show`). */
import { describe, expect, it } from 'vitest'
import {
  componentTag,
  isComponent,
  qualify,
  resolveRef,
  splitName,
  templateName,
} from '../src/check/project'

describe('view root names', () => {
  it('splits and joins a root prefix', () => {
    expect(splitName('billing::invoices/show')).toEqual({ root: 'billing', path: 'invoices/show' })
    expect(splitName('users/show')).toEqual({ path: 'users/show' })
    expect(qualify('billing', 'invoices/show')).toBe('billing::invoices/show')
    expect(qualify(undefined, 'users/show')).toBe('users/show')
  })

  it('accepts a root prefix as a template name, and nothing looser', () => {
    expect(templateName('billing::invoices/show')).toBe('billing::invoices/show')
    expect(templateName('a::b::c')).toBeUndefined()
    expect(templateName('Billing::x')).toBeUndefined()
    expect(templateName('billing::')).toBeUndefined()
    expect(templateName('::x')).toBeUndefined()
  })

  it("gives a root's components a tag that starts with the root", () => {
    expect(componentTag('ui::components/forms/field', 'components')).toBe('ui-forms-field')
    expect(componentTag('components/user-card', 'components')).toBe('user-card')
    expect(isComponent('ui::components/button', 'components')).toBe(true)
    expect(isComponent('ui::pages/x', 'components')).toBe(false)
  })

  it("resolves a reference in its own root first, then the app's", () => {
    const has = (n: string) => ['ui::layouts/main', 'layouts/main'].includes(n)
    expect(resolveRef('ui::page', 'layouts/main', has)).toBe('ui::layouts/main')
    expect(resolveRef('ui::page', 'layouts/other', has)).toBe('layouts/other')
    expect(resolveRef('page', 'layouts/main', has)).toBe('layouts/main')
    expect(resolveRef('ui::page', 'billing::x', has)).toBe('billing::x')
  })
})
