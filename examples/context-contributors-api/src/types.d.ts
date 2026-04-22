/**
 * Type augmentation for the Context Contributor pipeline (#107).
 *
 * Each entry tells TypeScript what type `ctx.set('key', ...)` accepts and
 * what `ctx.get('key')` returns. This is the canonical way to give your
 * app type-safe per-request metadata access; without it, both methods
 * fall back to `unknown`.
 */
declare module '@forinda/kickjs' {
  interface ContextMeta {
    /** Set by StartedAt — global contributor in bootstrap(). */
    requestStartedAt: number
    /** Set by LoadFlags — adapter contributor on FlagsAdapter. */
    flags: { beta: boolean; rolloutPercentage: number }
    /** Set by LoadAuditTrail — module contributor on ProjectsModule. */
    auditTrailEnabled: boolean
    /** Set by LoadTenant — class decorator on ProjectsController. */
    tenant: { id: string; name: string }
    /** Set by LoadProject — method decorator on ProjectsController.getOne. */
    project: { id: string; tenantId: string; title: string }
  }
}

export {}
