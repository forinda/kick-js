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
  /** Prisma client import path (default: '@prisma/client') */
  prismaClientPath?: string
  /** Custom repo type name (e.g. 'typeorm') — only for generateCustomRepository */
  repoType?: string
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
   * Module declaration style emitted for the module-index file.
   * Defaults to `'define'`. Resolved from `kick.config.ts > modules.style`
   * by the orchestrating generator before the template is invoked.
   */
  style?: ModuleStyle
}
