/**
 * snapshot → renderSchemaSource → schema → extractSnapshot → snapshot
 *
 * The render tests assert on the emitted text; this asserts the text actually
 * evaluates back into the same schema. That is the property `kick db
 * introspect` sells, and the one #643 broke: foreign keys were rendered as
 * comments, so the round-trip silently lost every one of them.
 */
import { describe, it, expect } from 'vitest'
import * as db from '@forinda/kickjs-db'
import { renderSchemaSource, extractSnapshot } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

/**
 * Evaluate rendered schema source and return the table objects it defines.
 *
 * The source is plain JS apart from its import line, so the helpers are passed
 * in as parameters instead — no bundler, no temp file.
 */
function evaluate(source: string, tableNames: string[]): Record<string, unknown> {
  const [importLine, ...rest] = source.split('\n')
  const helpers = (importLine.match(/import \{ (.+) \} from/)?.[1] ?? '')
    .split(', ')
    .filter(Boolean)
  const body = rest.join('\n').replace(/^export const /gm, 'const ')
  const ret = `return { ${tableNames.join(', ')} }`
  // eslint-disable-next-line no-new-func
  const factory = new Function(...helpers, `${body}\n${ret}`)
  return factory(...helpers.map((h) => (db as Record<string, unknown>)[h])) as Record<
    string,
    unknown
  >
}

const snapshot = (fkName: string): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: {
    users: {
      name: 'users',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        email: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
      indexes: [{ name: 'users_email_unique', columns: ['email'], unique: true }],
      foreignKeys: [],
      checks: [],
    },
    orders: {
      name: 'orders',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        user_id: {
          name: 'user_id',
          type: 'integer',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
      indexes: [],
      foreignKeys: [
        {
          name: fkName,
          columns: ['user_id'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      ],
      checks: [],
    },
  },
})

describe('render → extract round-trip', () => {
  // Postgres' own default naming, which is what introspecting a real database
  // produces — and what used to match nothing.
  for (const fkName of [
    'orders_user_id_fkey',
    'fk_orders_user',
    'orders_user_id_fk',
    // A quoted Postgres identifier may legally contain a quote. Rendering it
    // into a single-quoted literal produced a file that did not parse, so this
    // case only holds if the emitted source is escaped.
    "orders_user'id_fkey",
    'orders_user\\id_fkey',
  ]) {
    it(`preserves a foreign key named ${fkName}`, () => {
      const original = snapshot(fkName)
      const source = renderSchemaSource(original)
      const schema = evaluate(source, ['users', 'orders'])
      const extracted = extractSnapshot(schema, 'postgres')

      expect(extracted.tables.orders.foreignKeys).toEqual([
        {
          name: fkName,
          columns: ['user_id'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      ])
    })
  }

  it('round-trips the whole snapshot, not just the keys', () => {
    const original = snapshot('orders_user_id_fkey')
    const extracted = extractSnapshot(
      evaluate(renderSchemaSource(original), ['users', 'orders']),
      'postgres',
    )
    expect(extracted).toEqual(original)
  })
})
