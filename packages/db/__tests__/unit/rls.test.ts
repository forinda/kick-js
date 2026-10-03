/** D.26: row-level security, policies and roles through snapshot, diff, invert, emit and render. */
import { describe, expect, it } from 'vitest'
import {
  diff,
  emitPg,
  extractSnapshot,
  integer,
  invertChanges,
  renderSchemaSource,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { pgRole, policy } from '@forinda/kickjs-db/pg'

const appUser = pgRole('app_user')
const auditor = pgRole('auditor').existing()
const owner = `owner_id = current_setting('app.user_id')::int`
const docs = (ownerType = integer()) =>
  table(
    'docs',
    { id: serial().primaryKey(), ownerId: ownerType.notNull(), body: text() },
    {
      rls: { force: true },
      constraints: () => ({
        own: policy('docs_own').to(appUser).using(owner).withCheck(owner),
        audit: policy('docs_audit').for('select').to(auditor),
      }),
    },
  )
const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }

describe('row-level security', () => {
  it('snapshots policies, RLS and only the roles to create', () => {
    const snap = extractSnapshot({ appUser, auditor, docs: docs() }, 'postgres')
    expect(snap.roles).toEqual({ app_user: { name: 'app_user' } })
    expect(snap.tables.docs.rls).toEqual({ force: true })
    expect(snap.tables.docs.policies?.map((p) => [p.name, p.command, p.to])).toEqual([
      ['docs_own', 'all', ['app_user']],
      ['docs_audit', 'select', ['auditor']],
    ])
    // A policy alone turns it on.
    const plain = table('t', { id: serial().primaryKey() }, () => ({ p: policy('t_all') }))
    expect(extractSnapshot({ plain }, 'postgres').tables.t.rls).toEqual({})
    expect(() => extractSnapshot({ plain }, 'mysql')).toThrow(/Postgres-only/)
  })

  it('creates roles first, then the table, RLS and policies', () => {
    const sql = emitPg(diff(empty, extractSnapshot({ appUser, auditor, docs: docs() }, 'postgres')))
    const at = (s: string) => sql.indexOf(s)
    expect(sql).toContain(`IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user')`)
    expect(sql).not.toContain(`rolname = 'auditor'`)
    expect(at('CREATE ROLE')).toBeLessThan(at('CREATE TABLE'))
    expect(at('CREATE TABLE')).toBeLessThan(at('ENABLE ROW LEVEL SECURITY'))
    expect(sql).toContain('ALTER TABLE "docs" FORCE ROW LEVEL SECURITY;')
    expect(sql).toContain(
      `CREATE POLICY "docs_own" ON "docs" AS PERMISSIVE FOR ALL TO "app_user" USING (${owner}) WITH CHECK (${owner});`,
    )
    expect(sql).toContain(
      `CREATE POLICY "docs_audit" ON "docs" AS PERMISSIVE FOR SELECT TO "auditor";`,
    )
  })

  it('drops and re-creates policies around a change to their table, and inverts without roles', () => {
    const forward = diff(
      extractSnapshot({ appUser, docs: docs() }, 'postgres'),
      extractSnapshot({ appUser, docs: docs(text() as never) }, 'postgres'),
    )
    expect(forward.map((c) => ('policy' in c ? `${c.kind}:${c.policy.name}` : c.kind))).toEqual([
      'dropPolicy:docs_own',
      'dropPolicy:docs_audit',
      'alterColumn',
      'createPolicy:docs_own',
      'createPolicy:docs_audit',
    ])
    const back = invertChanges(diff(empty, extractSnapshot({ appUser, docs: docs() }, 'postgres')))
    expect(back.map((c) => c.kind)).toEqual(['dropTable'])
  })

  it('turns RLS off when the last policy and the option go', () => {
    const bare = table('docs', {
      id: serial().primaryKey(),
      ownerId: integer().notNull(),
      body: text(),
    })
    const sql = emitPg(
      diff(
        extractSnapshot({ appUser, docs: docs() }, 'postgres'),
        extractSnapshot({ appUser, docs: bare }, 'postgres'),
      ),
    )
    expect(sql).toContain('DROP POLICY "docs_own" ON "docs";')
    expect(sql).toContain('ALTER TABLE "docs" DISABLE ROW LEVEL SECURITY;')
    expect(sql).toContain('ALTER TABLE "docs" NO FORCE ROW LEVEL SECURITY;')
  })

  it('renders policies and forced RLS back into the schema', () => {
    const src = renderSchemaSource(extractSnapshot({ docs: docs() }, 'postgres'))
    expect(src).toContain("import { policy } from '@forinda/kickjs-db/pg'")
    expect(src).toContain('rls: { force: true }')
    expect(src).toContain(`docs_own: policy('docs_own').to('app_user').using(`)
    expect(src).toContain(`docs_audit: policy('docs_audit').for('select').to('auditor')`)
  })
})
