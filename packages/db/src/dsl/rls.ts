import type { PolicySnapshot, RoleSnapshot } from '../snapshot/types'

/** A database role, for `policy().to(...)` — created by migrations unless `.existing()`. */
export class RoleDecl {
  readonly __isRole = true
  readonly __role: RoleSnapshot
  /** Managed outside these migrations: referenced by policies, never created. */
  __existing = false

  constructor(name: string, options: Omit<RoleSnapshot, 'name'> = {}) {
    this.__role = { name, ...options }
  }

  /** The role already exists (created by your DBA or another app): never create it. */
  existing(): this {
    this.__existing = true
    return this
  }
}

/**
 * A Postgres role, declared with the schema:
 * `export const appUser = pgRole('app_user', { login: true })`.
 *
 * Roles belong to the whole server, not one database, so migrations create
 * one only if it's missing and never drop it — remove it yourself when no
 * database uses it. Passwords stay out of the schema: set them with
 * `ALTER ROLE … PASSWORD` outside migrations.
 */
export function pgRole(name: string, options: Omit<RoleSnapshot, 'name'> = {}): RoleDecl {
  return new RoleDecl(name, options)
}

export function isRole(value: unknown): value is RoleDecl {
  return value instanceof RoleDecl || (!!value && (value as RoleDecl).__isRole === true)
}

type Command = PolicySnapshot['command']

/** A row-level security policy, returned from a table's constraints. */
export class PolicyDecl {
  readonly kind = 'policy'
  readonly __policy: PolicySnapshot

  constructor(name: string) {
    this.__policy = { name, as: 'permissive', command: 'all', to: ['public'] }
  }

  /** Which statements it applies to. Default `'all'`. */
  for(command: Command): this {
    this.__policy.command = command
    return this
  }

  /** The roles it applies to, by name or `pgRole()`. Default `public` (everyone). */
  to(...roles: Array<string | RoleDecl>): this {
    this.__policy.to = roles.map((r) => (typeof r === 'string' ? r : r.__role.name))
    return this
  }

  /**
   * `'permissive'` (default): a row passes if any permissive policy allows it.
   * `'restrictive'`: every restrictive policy must allow it as well.
   */
  as(kind: 'permissive' | 'restrictive'): this {
    this.__policy.as = kind
    return this
  }

  /** Which existing rows are visible / updatable / deletable — a SQL boolean expression. */
  using(expression: string): this {
    this.__policy.using = expression
    return this
  }

  /** Which new rows may be written (insert, update) — a SQL boolean expression. */
  withCheck(expression: string): this {
    this.__policy.withCheck = expression
    return this
  }
}

/**
 * A row-level security policy (Postgres):
 *
 * ```ts
 * table('docs', columns, {
 *   constraints: (t) => ({
 *     ownDocs: policy('docs_owner')
 *       .to(appUser)
 *       .using(`owner_id = current_setting('app.user_id')::int`),
 *   }),
 * })
 * ```
 *
 * A table with a policy has row-level security turned on.
 */
export function policy(name: string): PolicyDecl {
  return new PolicyDecl(name)
}
