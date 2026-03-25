import type { RepoType } from '../module'

export interface ModuleContext {
  kebab: string
  pascal: string
  plural: string
  pluralPascal: string
  moduleDir: string
  repo: RepoType
  noEntity: boolean
  noTests: boolean
  prismaClientPath: string
  write: (relativePath: string, content: string) => Promise<void>
  files: string[]
}
