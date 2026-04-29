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
}
