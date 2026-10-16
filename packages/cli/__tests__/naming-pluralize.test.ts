import { describe, expect, it } from 'vitest'
import { pluralize } from '../src/utils/naming'

describe('pluralize (module folders)', () => {
  it('pluralizes resources and leaves concerns alone', () => {
    expect(pluralize('user')).toBe('users')
    expect(pluralize('cron')).toBe('crons')
    expect(pluralize('auth')).toBe('auth')
    expect(pluralize('health')).toBe('health')
  })
})
