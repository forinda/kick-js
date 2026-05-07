import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  findModuleFiles,
  findStyleDriftModules,
  migrateClassToDefine,
  migrateDefineToClass,
  migrateModulesDir,
  migrateModulesIndex,
} from '../src/generators/migrate-modules'

describe('migrateClassToDefine', () => {
  it('rewrites a basic class module to defineModule', () => {
    const input = `import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { TaskController } from './task.controller'
import { TASK_REPOSITORY } from './task.repository'
import { InMemoryTaskRepository } from './in-memory-task.repository'

export class TaskModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TASK_REPOSITORY, () =>
      container.resolve(InMemoryTaskRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/tasks',
      controller: TaskController,
    }
  }
}
`
    const result = migrateClassToDefine(input)
    expect(result.migrated).not.toBeNull()
    expect(result.migrated).toContain("import { defineModule } from '@forinda/kickjs'")
    expect(result.migrated).toContain('export const TaskModule = defineModule({')
    expect(result.migrated).toContain("name: 'TaskModule'")
    expect(result.migrated).toContain('register(container) {')
    expect(result.migrated).toContain('routes() {')
    expect(result.migrated).not.toContain('implements AppModule')
    expect(result.migrated).not.toContain('Container')
  })

  it('skips files already in defineModule form', () => {
    const input = `import { defineModule } from '@forinda/kickjs'
export const TaskModule = defineModule({ name: 'TaskModule', build: () => ({ routes: () => null }) })
`
    const result = migrateClassToDefine(input)
    expect(result.migrated).toBeNull()
    expect(result.reason).toContain('already in target form')
  })

  it('skips files without a class declaration', () => {
    const result = migrateClassToDefine(`export const X = 1\n`)
    expect(result.migrated).toBeNull()
    expect(result.reason).toContain('no class form')
  })

  it('handles modules without register() (routes-only)', () => {
    const input = `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { TaskController } from './task.controller'

export class TaskModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/tasks', controller: TaskController }
  }
}
`
    const result = migrateClassToDefine(input)
    expect(result.migrated).not.toBeNull()
    expect(result.migrated).toContain('defineModule({')
    expect(result.migrated).not.toContain('register(')
  })

  it('refuses files with multiple module classes', () => {
    const input = `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs'

export class AModule implements AppModule { routes(): ModuleRoutes { return null as never } }
export class BModule implements AppModule { routes(): ModuleRoutes { return null as never } }
`
    const result = migrateClassToDefine(input)
    expect(result.migrated).toBeNull()
    expect(result.reason).toContain('multiple module classes')
  })
})

describe('migrateDefineToClass', () => {
  it('rewrites a defineModule factory to class form', () => {
    const input = `import { defineModule } from '@forinda/kickjs'
import { TaskController } from './task.controller'
import { TASK_REPOSITORY } from './task.repository'

export const TaskModule = defineModule({
  name: 'TaskModule',
  build: () => ({
    register(container) {
      container.registerFactory(TASK_REPOSITORY, () =>
        container.resolve(TaskRepoImpl),
      )
    },

    routes() {
      return {
        path: '/tasks',
        controller: TaskController,
      }
    },
  }),
})
`
    const result = migrateDefineToClass(input)
    expect(result.migrated).not.toBeNull()
    expect(result.migrated).toContain('export class TaskModule implements AppModule {')
    expect(result.migrated).toContain('register(container: Container): void {')
    expect(result.migrated).toContain('routes(): ModuleRoutes {')
    expect(result.migrated).toContain('import { Container, type AppModule, type ModuleRoutes }')
    expect(result.migrated).not.toContain('defineModule')
  })

  it('skips files already in class form', () => {
    const input = `export class TaskModule implements AppModule { routes() { return null } }`
    const result = migrateDefineToClass(input)
    expect(result.migrated).toBeNull()
    expect(result.reason).toContain('already in target form')
  })

  it('handles defineModule without register()', () => {
    const input = `import { defineModule } from '@forinda/kickjs'
import { TaskController } from './task.controller'

export const TaskModule = defineModule({
  name: 'TaskModule',
  build: () => ({
    routes() {
      return { path: '/tasks', controller: TaskController }
    },
  }),
})
`
    const result = migrateDefineToClass(input)
    expect(result.migrated).not.toBeNull()
    expect(result.migrated).toContain('export class TaskModule implements AppModule {')
    expect(result.migrated).not.toContain('Container')
    expect(result.migrated).not.toContain('register(')
  })
})

describe('migrateModulesIndex', () => {
  it('rewrites AppModuleClass[] → AppModuleEntry[] with factory-call form (target=define)', () => {
    const input = `import type { AppModuleClass } from '@forinda/kickjs'
import { UserModule } from './users/user.module'
import { TaskModule } from './tasks/task.module'

export const modules: AppModuleClass[] = [UserModule, TaskModule]
`
    const result = migrateModulesIndex(input, 'define')
    expect(result.migrated).not.toBeNull()
    expect(result.migrated).toContain('AppModuleEntry[]')
    expect(result.migrated).toContain('[UserModule(), TaskModule()]')
    expect(result.migrated).not.toContain('AppModuleClass')
  })

  it('rewrites AppModuleEntry[] → AppModuleClass[] with bare references (target=class)', () => {
    const input = `import type { AppModuleEntry } from '@forinda/kickjs'
import { UserModule } from './users/user.module'

export const modules: AppModuleEntry[] = [UserModule(), TaskModule()]
`
    const result = migrateModulesIndex(input, 'class')
    expect(result.migrated).not.toBeNull()
    expect(result.migrated).toContain('AppModuleClass[]')
    expect(result.migrated).toContain('[UserModule, TaskModule]')
    expect(result.migrated).not.toContain('UserModule()')
  })

  it('is idempotent on already-migrated index files', () => {
    const defined = `import type { AppModuleEntry } from '@forinda/kickjs'
export const modules: AppModuleEntry[] = [UserModule()]
`
    expect(migrateModulesIndex(defined, 'define').migrated).toBeNull()

    const classed = `import type { AppModuleClass } from '@forinda/kickjs'
export const modules: AppModuleClass[] = [UserModule]
`
    expect(migrateModulesIndex(classed, 'class').migrated).toBeNull()
  })
})

describe('findModuleFiles — supports both <name>.module.ts AND legacy <sub>/index.ts', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kick-migrate-'))
    mkdirSync(join(dir, 'modules', 'users'), { recursive: true })
    mkdirSync(join(dir, 'modules', 'tasks'), { recursive: true })
    mkdirSync(join(dir, 'modules', 'orders'), { recursive: true })

    // Current convention — <name>.module.ts.
    writeFileSync(
      join(dir, 'modules', 'users', 'user.module.ts'),
      'export class UserModule implements AppModule { routes(): ModuleRoutes { return null as never } }',
    )
    // Legacy convention — index.ts inside the module folder.
    writeFileSync(
      join(dir, 'modules', 'tasks', 'index.ts'),
      'export class TaskModule implements AppModule { routes(): ModuleRoutes { return null as never } }',
    )
    // Mixed — folder has BOTH; both should be picked up.
    writeFileSync(
      join(dir, 'modules', 'orders', 'order.module.ts'),
      'export class OrderModule implements AppModule { routes(): ModuleRoutes { return null as never } }',
    )
    writeFileSync(
      join(dir, 'modules', 'orders', 'index.ts'),
      `export { OrderModule } from './order.module'`,
    )

    // The registry at the modulesDir root — must NOT be picked up.
    writeFileSync(
      join(dir, 'modules', 'index.ts'),
      `import type { AppModuleClass } from '@forinda/kickjs'
export const modules: AppModuleClass[] = []`,
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds all three module-declaration files (current + legacy index)', async () => {
    const files = await findModuleFiles(join(dir, 'modules'))
    expect(files.length).toBe(4)
    expect(files.some((f) => f.endsWith('users/user.module.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('tasks/index.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('orders/order.module.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('orders/index.ts'))).toBe(true)
  })

  it('excludes <modulesDir>/index.ts (the registry)', async () => {
    const files = await findModuleFiles(join(dir, 'modules'))
    const rootIndex = join(dir, 'modules', 'index.ts')
    expect(files.includes(rootIndex)).toBe(false)
  })

  it('findStyleDriftModules picks up class form in legacy index.ts files', async () => {
    const drift = await findStyleDriftModules(join(dir, 'modules'), 'define')
    // Three of the four files actually have a `class … implements AppModule`
    // declaration; the orders/index.ts only re-exports.
    expect(drift.length).toBeGreaterThanOrEqual(2)
    expect(drift.some((p) => p.endsWith('tasks/index.ts'))).toBe(true)
  })
})

describe('migrateModulesDir — backup behavior', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kick-backup-'))
    mkdirSync(join(dir, 'src', 'modules', 'tasks'), { recursive: true })
    writeFileSync(
      join(dir, 'src', 'modules', 'tasks', 'task.module.ts'),
      `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { TaskController } from './task.controller'

export class TaskModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/tasks', controller: TaskController }
  }
}
`,
    )
    writeFileSync(
      join(dir, 'src', 'modules', 'index.ts'),
      `import type { AppModuleClass } from '@forinda/kickjs'
import { TaskModule } from './tasks/task.module'

export const modules: AppModuleClass[] = [TaskModule]
`,
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a timestamped backup under .kickjs/codemod-backups/ when applying', async () => {
    const result = await migrateModulesDir(join(dir, 'src', 'modules'), {
      target: 'define',
      cwd: dir,
      dryRun: false,
    })

    expect(result.backupDir).not.toBeNull()
    expect(result.backupDir!).toMatch(/\.kickjs[\/\\]codemod-backups/)

    // Backup contains the original (pre-migration) file content.
    const backupModule = readFileSync(join(result.backupDir!, 'tasks', 'task.module.ts'), 'utf-8')
    expect(backupModule).toContain('class TaskModule implements AppModule')

    // The actual file was rewritten to defineModule form.
    const liveModule = readFileSync(join(dir, 'src', 'modules', 'tasks', 'task.module.ts'), 'utf-8')
    expect(liveModule).toContain('defineModule(')
    expect(liveModule).not.toContain('implements AppModule')
  })

  it('skips backup on dry-run', async () => {
    const result = await migrateModulesDir(join(dir, 'src', 'modules'), {
      target: 'define',
      cwd: dir,
      dryRun: true,
    })
    expect(result.backupDir).toBeNull()
    // The original file was NOT rewritten on dry-run.
    const liveModule = readFileSync(join(dir, 'src', 'modules', 'tasks', 'task.module.ts'), 'utf-8')
    expect(liveModule).toContain('class TaskModule implements AppModule')
  })

  it('skips backup when explicitly disabled', async () => {
    const result = await migrateModulesDir(join(dir, 'src', 'modules'), {
      target: 'define',
      cwd: dir,
      dryRun: false,
      backup: false,
    })
    expect(result.backupDir).toBeNull()
    expect(existsSync(join(dir, '.kickjs', 'codemod-backups'))).toBe(false)
  })
})

describe('CodeRabbit fixes', () => {
  describe('migrateDefineToClass — adds ContributorRegistrations import when contributors() present', () => {
    it('imports ContributorRegistrations alongside the class form', () => {
      const input = `import { defineModule } from '@forinda/kickjs'
import { LoadTenant } from './load-tenant'

export const TaskModule = defineModule({
  name: 'TaskModule',
  build: () => ({
    contributors() {
      return [LoadTenant.registration]
    },
    routes() {
      return { path: '/tasks', controller: TaskController }
    },
  }),
})
`
      const result = migrateDefineToClass(input)
      expect(result.migrated).not.toBeNull()
      expect(result.migrated).toContain('contributors(): ContributorRegistrations {')
      expect(result.migrated).toContain('type ContributorRegistrations')
    })
  })

  describe('findModuleFiles — depth-aware legacy index.ts discovery', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'kick-depth-'))
      // Direct child — legacy module convention. Should be picked up.
      mkdirSync(join(dir, 'modules', 'tasks'), { recursive: true })
      writeFileSync(
        join(dir, 'modules', 'tasks', 'index.ts'),
        'export class TaskModule implements AppModule { routes(): ModuleRoutes { return null as never } }',
      )
      // Nested barrel files (DDD layout) — must NOT be picked up.
      mkdirSync(join(dir, 'modules', 'tasks', 'application'), { recursive: true })
      writeFileSync(
        join(dir, 'modules', 'tasks', 'application', 'index.ts'),
        'export * from "./create-task.use-case"',
      )
      mkdirSync(join(dir, 'modules', 'tasks', 'domain'), { recursive: true })
      writeFileSync(
        join(dir, 'modules', 'tasks', 'domain', 'index.ts'),
        'export * from "./task.entity"',
      )
      // Registry at modulesDir root — excluded.
      writeFileSync(join(dir, 'modules', 'index.ts'), 'export const modules = []')
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('picks up only the depth-1 legacy index.ts, not nested barrels or the registry', async () => {
      const files = await findModuleFiles(join(dir, 'modules'))
      expect(files).toEqual([join(dir, 'modules', 'tasks', 'index.ts')])
    })
  })

  describe('migrateModulesDir — backup when registry-only changes', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'kick-registry-backup-'))
      mkdirSync(join(dir, 'src', 'modules'), { recursive: true })
      // No module files; only a stale-typed registry that needs the
      // type rename + factory-call rewrite.
      writeFileSync(
        join(dir, 'src', 'modules', 'index.ts'),
        `import type { AppModuleClass } from '@forinda/kickjs'
import { TaskModule } from './tasks/task.module'

export const modules: AppModuleClass[] = [TaskModule]
`,
      )
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('snapshots before rewriting a registry-only project', async () => {
      const result = await migrateModulesDir(join(dir, 'src', 'modules'), {
        target: 'define',
        cwd: dir,
        dryRun: false,
      })
      expect(result.backupDir).not.toBeNull()
      const backupRegistry = readFileSync(join(result.backupDir!, 'index.ts'), 'utf-8')
      expect(backupRegistry).toContain('AppModuleClass[]')
      const liveRegistry = readFileSync(join(dir, 'src', 'modules', 'index.ts'), 'utf-8')
      expect(liveRegistry).toContain('AppModuleEntry[]')
      expect(liveRegistry).toContain('[TaskModule()]')
    })
  })
})
