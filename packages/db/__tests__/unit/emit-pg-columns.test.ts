import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

const before = {
  name: 'age',
  type: 'integer',
  nullable: true,
  default: null,
  primaryKey: false,
}
const after = {
  name: 'age',
  type: 'bigint',
  nullable: false,
  default: '0',
  primaryKey: false,
}

describe('emitPg() — column changes', () => {
  it('ADD COLUMN', () => {
    const cs: ChangeSet = [
      {
        kind: 'addColumn',
        table: 'users',
        column: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" ADD COLUMN "email" varchar(255) NOT NULL;')
  })

  it('DROP COLUMN', () => {
    const cs: ChangeSet = [
      {
        kind: 'dropColumn',
        table: 'users',
        column: {
          name: 'legacy',
          type: 'text',
          nullable: true,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" DROP COLUMN "legacy";')
  })

  it('RENAME COLUMN', () => {
    const cs: ChangeSet = [{ kind: 'renameColumn', table: 'users', from: 'emailAddr', to: 'email' }]
    expect(emitPg(cs)).toBe('ALTER TABLE "users" RENAME COLUMN "emailAddr" TO "email";')
  })

  it('ALTER COLUMN — type + nullable + default', () => {
    const cs: ChangeSet = [{ kind: 'alterColumn', table: 'users', column: 'age', before, after }]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "users" ALTER COLUMN "age" TYPE bigint USING "age"::bigint;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" SET NOT NULL;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" SET DEFAULT 0;',
    )
  })

  it('ALTER COLUMN — drop default + drop NOT NULL', () => {
    const cs: ChangeSet = [
      {
        kind: 'alterColumn',
        table: 'users',
        column: 'age',
        before: {
          name: 'age',
          type: 'integer',
          nullable: false,
          default: '0',
          primaryKey: false,
        },
        after: {
          name: 'age',
          type: 'integer',
          nullable: true,
          default: null,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "users" ALTER COLUMN "age" DROP DEFAULT;\n' +
        'ALTER TABLE "users" ALTER COLUMN "age" DROP NOT NULL;',
    )
  })

  // Regression: a non-string default (e.g. from `boolean().default(false)`)
  // must not crash the emitter (`value.replace is not a function`).
  it('emits non-string defaults (boolean / number) as bare SQL literals', () => {
    const cs: ChangeSet = [
      {
        kind: 'addColumn',
        table: 'tasks',
        // `default` is typed string, but harden against a raw boolean/number
        // slipping through (snapshot drift / pre-normalisation defaults).
        column: {
          name: 'done',
          type: 'boolean',
          nullable: false,
          default: false as unknown as string,
          primaryKey: false,
        },
      },
      {
        kind: 'addColumn',
        table: 'tasks',
        column: {
          name: 'qty',
          type: 'integer',
          nullable: false,
          default: 0 as unknown as string,
          primaryKey: false,
        },
      },
    ]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "tasks" ADD COLUMN "done" boolean NOT NULL DEFAULT false;\n' +
        'ALTER TABLE "tasks" ADD COLUMN "qty" integer NOT NULL DEFAULT 0;',
    )
  })
})

describe('emitPg() — defaults are rendered from the column type (#646)', () => {
  const col = (type: string, def: string) => ({
    name: 'status',
    type,
    nullable: false,
    default: def,
    primaryKey: false,
  })

  const addColumn = (type: string, def: string): ChangeSet => [
    { kind: 'addColumn', table: 'users', column: col(type, def) },
  ]

  it('quotes an uppercase word on a varchar instead of emitting bare SQL', () => {
    // `DEFAULT ACTIVE` is a syntax error. The value's shape says "SQL keyword";
    // only the column type says otherwise.
    expect(emitPg(addColumn('varchar(20)', 'ACTIVE'))).toContain("DEFAULT 'ACTIVE'")
  })

  it('quotes a digits-only text default', () => {
    expect(emitPg(addColumn('text', '0800'))).toContain("DEFAULT '0800'")
  })

  it('quotes a text default that reads as a boolean', () => {
    expect(emitPg(addColumn('text', 'true'))).toContain("DEFAULT 'true'")
  })

  it('quotes a text default that reads as a function call', () => {
    expect(emitPg(addColumn('varchar(40)', 'now()'))).toContain("DEFAULT 'now()'")
  })

  it('quotes a jsonb default rather than reading the braces as SQL', () => {
    expect(emitPg(addColumn('jsonb', '{}'))).toContain("DEFAULT '{}'")
  })

  it('decides an array by its element type', () => {
    expect(emitPg(addColumn('text[]', '{}'))).toContain("DEFAULT '{}'")
  })

  it('still passes expression defaults through on the types that have them', () => {
    expect(emitPg(addColumn('timestamptz', 'CURRENT_TIMESTAMP'))).toContain(
      'DEFAULT CURRENT_TIMESTAMP',
    )
    expect(emitPg(addColumn('uuid', 'gen_random_uuid()'))).toContain('DEFAULT gen_random_uuid()')
    expect(emitPg(addColumn('integer', '0'))).toContain('DEFAULT 0')
    expect(emitPg(addColumn('boolean', 'false'))).toContain('DEFAULT false')
  })

  it('passes a value that already carries a cast straight through', () => {
    // The enum recreate path composes `'active'::"status"` itself.
    expect(emitPg(addColumn('status', `'active'::"status"`))).toContain(
      'DEFAULT \'active\'::"status"',
    )
  })

  it('applies the same rule to ALTER COLUMN SET DEFAULT', () => {
    const cs: ChangeSet = [
      {
        kind: 'alterColumn',
        table: 'users',
        before: { ...col('varchar(20)', 'DRAFT'), default: null },
        after: col('varchar(20)', 'DRAFT'),
      },
    ]
    expect(emitPg(cs)).toContain("SET DEFAULT 'DRAFT'")
  })
})
