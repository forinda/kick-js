/**
 * Rendering enum types and enum columns (#644).
 *
 * Introspect read an enum column's type name and then discarded it — the column
 * came out as `text(/* TODO: enum_x *\/)` and the type itself was never
 * declared. A 242-table schema rebuilt that way had 37 columns of the wrong
 * type and none of its 36 enum types.
 */
import { describe, it, expect } from 'vitest'
import { renderSchemaSource } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const snap = (over: Partial<SchemaSnapshot> = {}): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  enums: {
    enum_grading_systems_type: {
      name: 'enum_grading_systems_type',
      values: ['departmental', 'general'],
    },
  },
  tables: {
    grading_systems: {
      name: 'grading_systems',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        type: {
          name: 'type',
          type: 'enum_grading_systems_type',
          nullable: false,
          default: 'departmental',
          primaryKey: false,
        },
      },
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
  ...over,
})

describe('renderSchemaSource() — enums', () => {
  it('declares the enum type instead of losing it', () => {
    expect(renderSchemaSource(snap())).toContain(
      "export const enum_grading_systems_type = pgEnum('enum_grading_systems_type', 'departmental', 'general')",
    )
  })

  it('renders the column through the declared factory, not text()', () => {
    const src = renderSchemaSource(snap())
    expect(src).toContain('type: enum_grading_systems_type().notNull().default("departmental")')
    expect(src).not.toContain('TODO')
  })

  it('imports pgEnum from the dialect subpath', () => {
    expect(renderSchemaSource(snap())).toContain("import { pgEnum } from '@forinda/kickjs-db/pg'")
  })

  it('declares enums before the tables that use them', () => {
    const src = renderSchemaSource(snap())
    expect(src.indexOf('pgEnum(')).toBeLessThan(src.indexOf('table('))
  })

  it('adds no pgEnum import when the schema has no enums', () => {
    const s = snap({ enums: undefined })
    s.tables.grading_systems.columns.type.type = 'text'
    expect(renderSchemaSource(s)).not.toContain('pgEnum')
  })

  it('escapes a quote inside an enum value', () => {
    const s = snap({
      enums: { moods: { name: 'moods', values: ["it's fine", 'ok'] } },
    })
    // The rendered source must be valid JS: a quote inside a value is escaped.
    expect(renderSchemaSource(s)).toContain("pgEnum('moods', 'it\\'s fine', 'ok')")
  })

  it('keeps declaration order — for an enum it is part of the type', () => {
    const s = snap({ enums: { sizes: { name: 'sizes', values: ['small', 'large', 'medium'] } } })
    expect(renderSchemaSource(s)).toContain("pgEnum('sizes', 'small', 'large', 'medium')")
  })

  it('gives an enum column the same modifier chain as any other', () => {
    const s = snap()
    s.tables.grading_systems.columns.type.nullable = true
    s.tables.grading_systems.columns.type.default = null
    expect(renderSchemaSource(s)).toContain('type: enum_grading_systems_type(),')
  })
})
