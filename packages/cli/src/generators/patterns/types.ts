import type { RepoType } from '../module'
import type { ModuleStyle } from '../templates/types'

export interface ModuleContext {
  kebab: string
  pascal: string
  plural: string
  pluralPascal: string
  moduleDir: string
  repo: RepoType
  noEntity: boolean
  noTests: boolean
  /**
   * DI-token scope prefix substituted into emitted `createToken<T>()`
   * literals. Threaded down through pattern generators into every
   * template that emits a token. Default `'app'`.
   */
  tokenScope: string
  /**
   * Module declaration style — `'define'` (factory, default) or
   * `'class'` (legacy). Resolved by the orchestrating command from
   * `kick.config.ts > modules.style`. Threaded into every module-index
   * template that emits the declaration.
   */
  style: ModuleStyle
  write: (relativePath: string, content: string) => Promise<void>
  files: string[]
  /** Project depends on @forinda/kickjs-swagger — gates @ApiTags. */
  swagger?: boolean
  /** Project has kickjs-testing + supertest — gates the real controller test. */
  testHarness?: boolean
}
