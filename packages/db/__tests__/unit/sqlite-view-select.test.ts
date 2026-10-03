/** The SELECT inside a stored SQLite CREATE VIEW statement. */
import { expect, it } from 'vitest'
import { viewSelect } from '../../src/migrate/introspect-sqlite'

it('reads past the view header, whatever the name holds', () => {
  expect(viewSelect('CREATE VIEW v AS SELECT 1')).toBe('SELECT 1')
  expect(viewSelect('CREATE VIEW "sales as of" AS SELECT 2;')).toBe('SELECT 2')
  expect(
    viewSelect('CREATE TEMP VIEW IF NOT EXISTS main."x""as" (a, "b as c") AS\nSELECT 3, 4'),
  ).toBe('SELECT 3, 4')
  expect(viewSelect('create view [as] as select 5')).toBe('select 5')
  expect(viewSelect('CREATE VIEW `as`(n) AS SELECT 6')).toBe('SELECT 6')
})
