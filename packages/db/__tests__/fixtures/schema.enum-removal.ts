// Fixture for the M4.C composite-detect gate test in
// __tests__/unit/cli-generate-composite-gate.test.ts.
//
// The exported enum has TWO values; the test's planted prior snapshot
// has THREE — `diff()` produces a single `removeEnumValue` change for
// `legacy`, which is what the gate keys off.

import { table, serial } from '@forinda/kickjs-db'
import { pgEnum } from '@forinda/kickjs-db/pg'

export const status = pgEnum('status', 'active', 'banned')

export const users = table('users', {
  id: serial().primaryKey(),
})
