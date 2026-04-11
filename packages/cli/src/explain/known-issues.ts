/**
 * Known-issues registry for `kick explain`.
 *
 * Each entry is a pattern matcher + a diagnosis. The matcher receives
 * the user's error text (and optionally project context) and returns
 * either a `Match` object (with confidence + extracted captures) or
 * `null` if it doesn't apply. `kick explain` runs every matcher,
 * picks the highest-confidence match, and prints its diagnosis.
 *
 * This file is the single source of truth for KickJS-specific pitfalls.
 * Adding a new entry takes ~30 lines and gives every user a permanent
 * fix path for that error. Keep entries focused: one issue per entry,
 * targeted matchers (avoid over-broad regexes), specific fixes.
 *
 * Confidence scoring (0–100):
 *   100 — certainty (error message has the exact symbol we're looking for)
 *    80 — high (multiple correlated signals)
 *    60 — medium (single strong signal)
 *    40 — low (heuristic match, mention to user as a guess)
 *  < 40 — discarded
 *
 * The matcher should never throw — always catch and return null on
 * unexpected input.
 */

export interface ExplainContext {
  /** Project root if known (cwd of `kick explain`). */
  cwd?: string
  /** Set of file paths the matcher can check for existence. */
  hasFile?: (path: string) => boolean
}

export interface Diagnosis {
  /** Stable identifier — used in tests, telemetry, and bug reports. */
  id: string
  /** Short human-readable title shown above the explanation. */
  title: string
  /** Multi-paragraph explanation of what's wrong and why it happens. */
  explanation: string
  /**
   * The fix to apply, written as instructions a human can follow. May
   * include code snippets via the `codeBefore` / `codeAfter` fields.
   */
  fix: string
  /** Optional snippet showing the broken state. */
  codeBefore?: string
  /** Optional snippet showing the corrected state. */
  codeAfter?: string
  /** Doc URL for further reading. */
  docs?: string
}

export interface Match {
  /** 0–100; matchers below 40 are discarded by `findBestMatch`. */
  confidence: number
  diagnosis: Diagnosis
}

export interface KnownIssue {
  match(input: string, ctx?: ExplainContext): Match | null
}

// ── Helper: case-insensitive multi-pattern check ─────────────────────────

function includesAll(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase()
  return needles.every((n) => lower.includes(n.toLowerCase()))
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase()
  return needles.some((n) => lower.includes(n.toLowerCase()))
}

// ── Issue 1: env schema not registered ───────────────────────────────────

const envSchemaNotRegistered: KnownIssue = {
  match(input, _ctx) {
    // Strong signals: error mentions config.get + undefined, OR
    // mentions @Value returning unexpected value
    const hasConfigGetUndefined =
      includesAll(input, ['config', 'get']) && includesAny(input, ['undefined', 'null'])
    const hasValueUndefined =
      input.includes('@Value') && includesAny(input, ['undefined', 'is not defined'])

    if (!hasConfigGetUndefined && !hasValueUndefined) return null

    return {
      confidence: hasConfigGetUndefined && hasValueUndefined ? 90 : 75,
      diagnosis: {
        id: 'env-schema-not-registered',
        title: 'ConfigService.get() returns undefined for user-defined keys',
        explanation:
          'Your src/index.ts is missing `import "./config"`. That side-effect import\n' +
          'registers the env schema with kickjs at module-load time. Without it,\n' +
          'ConfigService falls back to the base schema (PORT/NODE_ENV/LOG_LEVEL only)\n' +
          'and every user-defined key reads as undefined. @Value() may *appear* to\n' +
          'work via a raw process.env fallback, but Zod coercion and schema defaults\n' +
          'are silently skipped.',
        fix: 'Add this line to src/index.ts near the top, before bootstrap() runs:',
        codeBefore:
          "import 'reflect-metadata'\n" +
          "import { bootstrap } from '@forinda/kickjs'\n" +
          "import { modules } from './modules'\n",
        codeAfter:
          "import 'reflect-metadata'\n" +
          "import './config'  // ← add this — registers env schema\n" +
          "import { bootstrap } from '@forinda/kickjs'\n" +
          "import { modules } from './modules'\n",
        docs: 'https://forinda.github.io/kick-js/guide/configuration.html#wiring-the-schema-at-startup',
      },
    }
  },
}

// ── Issue 2: missing Container.reset() in tests ──────────────────────────

const containerNotReset: KnownIssue = {
  match(input, _ctx) {
    const hasTestContext = includesAny(input, ['vitest', 'test', 'spec', '__tests__', '.test.'])
    const hasDuplicate = includesAny(input, [
      'already registered',
      'already exists',
      'duplicate',
      'has been registered',
    ])
    if (!hasDuplicate) return null

    return {
      confidence: hasTestContext ? 85 : 60,
      diagnosis: {
        id: 'container-not-reset-in-tests',
        title: 'DI container leaks between test cases',
        explanation:
          'KickJS decorators register classes on the global Container at import time.\n' +
          'When vitest re-imports your modules across tests, the same class can be\n' +
          'registered twice and the container throws. The fix is to wipe the\n' +
          'container between tests so each case starts fresh.',
        fix: 'Add Container.reset() to a beforeEach hook in the failing test file:',
        codeAfter:
          "import { describe, it, beforeEach } from 'vitest'\n" +
          "import { Container } from '@forinda/kickjs'\n\n" +
          "describe('UserController', () => {\n" +
          '  beforeEach(() => Container.reset())\n\n' +
          "  it('does the thing', async () => { /* ... */ })\n" +
          '})',
        docs: 'https://forinda.github.io/kick-js/guide/testing.html',
      },
    }
  },
}

// ── Issue 3: @Module decorator (NestJS-style) ────────────────────────────

const moduleDecoratorNotFound: KnownIssue = {
  match(input, _ctx) {
    const hasModuleSymbol =
      input.includes('@Module') ||
      includesAll(input, ['Module', 'is not a function']) ||
      includesAll(input, ['Module', 'no exported member'])
    if (!hasModuleSymbol) return null

    return {
      confidence: 80,
      diagnosis: {
        id: 'module-decorator-not-found',
        title: 'KickJS does not have a @Module decorator (different pattern from NestJS)',
        explanation:
          'NestJS uses @Module({ controllers, providers }). KickJS uses an interface\n' +
          'pattern instead: a class implements AppModule and exposes routes() that\n' +
          'returns the controller wiring. This was a deliberate choice — modules\n' +
          'become explicit values rather than metadata, which makes them easier to\n' +
          'compose, test, and serialize.',
        fix: 'Replace the @Module decorator with an AppModule class:',
        codeBefore:
          "import { Module } from '@forinda/kickjs'  // ← does not exist\n" +
          "import { UserController } from './user.controller'\n\n" +
          '@Module({\n' +
          '  controllers: [UserController],\n' +
          '})\n' +
          'export class UserModule {}',
        codeAfter:
          "import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'\n" +
          "import { UserController } from './user.controller'\n\n" +
          'export class UserModule implements AppModule {\n' +
          '  routes(): ModuleRoutes {\n' +
          '    return {\n' +
          "      path: '/users',\n" +
          '      router: buildRoutes(UserController),\n' +
          '      controller: UserController,\n' +
          '    }\n' +
          '  }\n' +
          '}',
        docs: 'https://forinda.github.io/kick-js/guide/project-structure.html',
      },
    }
  },
}

// ── Issue 4: legacy KickRoutes['POST /users'] syntax ─────────────────────

const legacyRoutesSyntax: KnownIssue = {
  match(input, _ctx) {
    // Old syntax: KickRoutes['POST /something'] — check for the bracket
    // form with HTTP verbs that doesn't match the new namespace shape.
    const hasBracketSyntax = /KickRoutes\s*\[\s*['"](GET|POST|PUT|PATCH|DELETE)/i.test(input)
    if (!hasBracketSyntax) return null

    return {
      confidence: 95,
      diagnosis: {
        id: 'legacy-kick-routes-bracket-syntax',
        title: "KickRoutes['POST /users'] is the legacy v1 syntax",
        explanation:
          'KickJS v2 changed the typegen output from a flat string-keyed map to a\n' +
          'namespaced shape: KickRoutes.UserController["create"] instead of\n' +
          'KickRoutes["POST /users"]. The new form is per-controller, per-method,\n' +
          'and matches the actual class names so refactors propagate via\n' +
          'rename-symbol instead of grep.',
        fix: 'Update the Ctx<...> type parameter to use the namespace form:',
        codeBefore:
          "@Post('/', { body: createUserSchema })\n" +
          "create(ctx: Ctx<KickRoutes['POST /users']>) { /* ... */ }",
        codeAfter:
          "@Post('/', { body: createUserSchema, name: 'CreateUser' })\n" +
          "create(ctx: Ctx<KickRoutes.UserController['create']>) { /* ... */ }",
        docs: 'https://forinda.github.io/kick-js/guide/typegen.html',
      },
    }
  },
}

// ── Issue 5: cluster + Vite dev mode → duplicate servers ────────────────

const clusterInDevMode: KnownIssue = {
  match(input, _ctx) {
    const hasCluster = includesAny(input, ['cluster', 'workers', 'two ports', 'duplicate server'])
    const hasDevSignal = includesAny(input, [
      'kick dev',
      'vite',
      'eaddrinuse',
      '5173',
      '5174',
      'two servers',
    ])
    if (!hasCluster || !hasDevSignal) return null

    return {
      confidence: 85,
      diagnosis: {
        id: 'cluster-in-vite-dev',
        title: 'Cluster mode is incompatible with `kick dev` (Vite owns the server)',
        explanation:
          'In dev mode, Vite owns the HTTP server. If your bootstrap passes\n' +
          'cluster: { workers: N }, the framework forks N workers, each of which\n' +
          'spins up its own Vite instance on a separate port. The fix landed in\n' +
          'v2.2.5: McpAdapter (and bootstrap()) now detects Vite dev mode and\n' +
          'silently skips cluster, with a warning. If you see this on an older\n' +
          'version, upgrade or guard the cluster option behind NODE_ENV.',
        fix: 'Either upgrade to v2.2.5+ or gate cluster mode on production:',
        codeAfter:
          'export const app = await bootstrap({\n' +
          '  modules,\n' +
          "  cluster: process.env.NODE_ENV === 'production' ? { workers: 4 } : false,\n" +
          '})',
        docs: 'https://forinda.github.io/kick-js/guide/cluster.html',
      },
    }
  },
}

// ── Issue 6: missing reflect-metadata import ─────────────────────────────

const reflectMetadataMissing: KnownIssue = {
  match(input, _ctx) {
    const hasReflectError = includesAny(input, [
      'reflect-metadata',
      'Reflect.getMetadata is not a function',
      'Reflect.defineMetadata',
      'design:type',
      'design:paramtypes',
    ])
    if (!hasReflectError) return null

    return {
      confidence: 90,
      diagnosis: {
        id: 'reflect-metadata-missing',
        title: 'reflect-metadata is not loaded — DI cannot read decorator types',
        explanation:
          'The DI container reads constructor parameter types via the\n' +
          'reflect-metadata polyfill. The polyfill must be imported once,\n' +
          'before any decorator runs. Most projects do this at the top of\n' +
          'src/index.ts; missing the import causes obscure "design:paramtypes"\n' +
          'or "Reflect.getMetadata is not a function" errors at runtime.',
        fix: 'Add the import at the very top of src/index.ts:',
        codeAfter:
          "import 'reflect-metadata'  // ← must be the FIRST import\n" +
          "import './config'\n" +
          "import { bootstrap } from '@forinda/kickjs'\n" +
          "import { modules } from './modules'\n\n" +
          'export const app = await bootstrap({ modules })',
        docs: 'https://forinda.github.io/kick-js/guide/dependency-injection.html',
      },
    }
  },
}

// ── Issue 7: forgot to register module in modules array ──────────────────

const moduleNotRegistered: KnownIssue = {
  match(input, _ctx) {
    const hasNotFound = includesAny(input, ['404', 'cannot get', 'cannot post', 'no route'])
    if (!hasNotFound) return null

    return {
      confidence: 50,
      diagnosis: {
        id: 'module-not-registered',
        title: 'A 404 may indicate a module is not in the modules array',
        explanation:
          'KickJS only mounts modules listed in `src/modules/index.ts`. If you\n' +
          "generated a module via `kick g module foo` but the routes don't appear,\n" +
          'the most likely cause is that the module is missing from the exported\n' +
          'array. The CLI usually wires this automatically, but a hand-edit can\n' +
          'drop the entry.',
        fix: 'Open src/modules/index.ts and verify the module is in the array:',
        codeAfter:
          "import type { AppModuleClass } from '@forinda/kickjs'\n" +
          "import { UserModule } from './users/user.module'\n" +
          "import { TaskModule } from './tasks/task.module'  // ← was this missing?\n\n" +
          'export const modules: AppModuleClass[] = [UserModule, TaskModule]',
        docs: 'https://forinda.github.io/kick-js/guide/project-structure.html',
      },
    }
  },
}

// ── Registry ──────────────────────────────────────────────────────────────

export const KNOWN_ISSUES: KnownIssue[] = [
  envSchemaNotRegistered,
  containerNotReset,
  moduleDecoratorNotFound,
  legacyRoutesSyntax,
  clusterInDevMode,
  reflectMetadataMissing,
  moduleNotRegistered,
]

/**
 * Run every matcher against the input and return the highest-confidence
 * hit, or `null` if no matcher cleared the 40-confidence threshold.
 */
export function findBestMatch(input: string, ctx?: ExplainContext): Match | null {
  let best: Match | null = null
  for (const issue of KNOWN_ISSUES) {
    let match: Match | null = null
    try {
      match = issue.match(input, ctx)
    } catch {
      // Matchers should never throw, but if one does, ignore it rather
      // than letting a buggy entry crash the whole explain command.
      continue
    }
    if (!match || match.confidence < 40) continue
    if (!best || match.confidence > best.confidence) {
      best = match
    }
  }
  return best
}
