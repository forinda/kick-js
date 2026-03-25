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
}
