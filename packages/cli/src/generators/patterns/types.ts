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
  /**
   * DI-token scope prefix substituted into emitted `createToken<T>()`
   * literals. Threaded down through pattern generators into every
   * template that emits a token. Default `'app'`.
   */
  tokenScope: string
  write: (relativePath: string, content: string) => Promise<void>
  files: string[]
}
