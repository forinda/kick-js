// Runtime companion to columns-array-brands.test-d.ts — the type-level
// assertions live there because vitest only enforces them under
// `--typecheck` (include: `**/*.test-d.ts`).
import { describe, it, expect } from 'vitest'

import { integer } from '../../src/index'

describe('array() brand preservation (runtime)', () => {
  it('notNull().array() keeps [] suffix and NOT NULL state', () => {
    const snap = integer().notNull().array().toJSON('xs')
    expect(snap.type).toBe('integer[]')
    expect(snap.nullable).toBe(false)
  })
})
