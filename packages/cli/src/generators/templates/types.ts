import type { SchemaLib } from '../../config'

/**
 * Module declaration style emitted by the module-index templates.
 *
 * - `'define'` — `defineModule({ name, build: () => ({...}) })`
 *   factory form. The recommended pattern; matches `defineAdapter`
 *   / `definePlugin` / `defineContextDecorator` parity.
 * - `'class'` — legacy `class FooModule implements AppModule { ... }`
 *   form. Still fully supported by the framework loader; pin via
 *   `kick.config.ts > modules.style: 'class'` for projects that
 *   prefer the class shape (existing codebase consistency, custom
 *   class-decorator setups, etc.).
 *
 * Default `'define'` for new code. The `kick g module` orchestrator
 * inserts the matching shape into `src/modules/index.ts` (`Module()`
 * vs `Module`); `kick rm module` matches both.
 */
export type ModuleStyle = 'define' | 'class'

/** Shared context for all template generator functions */
export interface TemplateContext {
  /** PascalCase name (e.g. 'User', 'TaskAssignee') */
  pascal: string
  /** kebab-case name (e.g. 'user', 'task-assignee') */
  kebab: string
  /** Pluralized kebab-case (e.g. 'users', 'task-assignees') */
  plural?: string
  /** Pluralized PascalCase (e.g. 'Users', 'TaskAssignees') */
  pluralPascal?: string
  /** Repository interface import prefix (default: '../../domain/repositories') */
  repoPrefix?: string
  /** DTO import prefix (default: '../../application/dtos') */
  dtoPrefix?: string
  /** Custom repo type name (e.g. 'typeorm') — only for generateCustomRepository */
  repoType?: string
  /**
   * Emit `@ApiTags` and its import. Only when the project actually depends on
   * `@forinda/kickjs-swagger` — generating an import for a package that is
   * not installed produces a module that cannot compile.
   */
  swagger?: boolean
  /**
   * DI-token scope prefix used by templates that emit `createToken<T>()`
   * literals. Default `'app'`. The orchestrating generator
   * (module / scaffold / leaf) resolves this from `kick.config.ts`
   * `tokenScope` or the project's `package.json` name (`@scope/pkg`
   * → `'scope'`); template helpers should treat this as the source
   * of truth for the `<scope>` portion of any emitted token literal.
   */
  tokenScope?: string
  /**
   * Project has `@forinda/kickjs-testing` and `supertest` available, so the
   * generated controller test can boot the module for real.
   *
   * Same rule as {@link TemplateContext.swagger}: emitting an import for a
   * package that is not installed produces a file that cannot compile. The
   * scaffolded templates install both as devDependencies, so this is true for
   * `kick new` projects and false for a bare one — which then gets the same
   * test with every case as `it.todo` and no extra imports.
   */
  testHarness?: boolean
  /**
   * Validation library the emitted DTO schemas are written against.
   * Defaults to `'zod'`. Resolved from the project's dependencies by the
   * orchestrating generator (`resolveSchemaLib`) — same rule as
   * {@link TemplateContext.swagger}: importing a package the project does not
   * install produces a file that cannot compile.
   */
  schemaLib?: SchemaLib
  /**
   * Module declaration style emitted for the module-index file.
   * Defaults to `'define'`. Resolved from `kick.config.ts > modules.style`
   * by the orchestrating generator before the template is invoked.
   */
  style?: ModuleStyle
}
