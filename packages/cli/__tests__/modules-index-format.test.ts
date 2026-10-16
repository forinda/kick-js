/**
 * `kick g module` appends to the scaffold's modules list in order, and
 * `kick rm module hello` removes the scaffold's example cleanly.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { appendModuleEntry } from '../src/generators/module'
import { removeModule } from '../src/generators/remove-module'

const scaffolded = readFileSync(
  resolve(__dirname, '../templates/base/files/src/modules/index.ts'),
  'utf8',
)

describe('modules index', () => {
  it('appends modules in order', () => {
    const twice = appendModuleEntry(
      appendModuleEntry(scaffolded, 'ProjectModule()'),
      'TaskModule()',
    )
    const rhs = twice.slice(twice.indexOf('defineModules()')).replace(/\s+/g, '')
    expect(rhs).toBe(
      'defineModules().mount(HelloModule()).mount(ProjectModule()).mount(TaskModule())',
    )
  })

  it('kick rm module hello removes the scaffold example, folder and line', async () => {
    const modulesDir = mkdtempSync(join(tmpdir(), 'kick-modules-'))
    mkdirSync(join(modulesDir, 'hello'))
    const withProject = appendModuleEntry(scaffolded, 'ProjectModule()').replace(
      'import { HelloModule }',
      "import { ProjectModule } from './projects/project.module'\nimport { HelloModule }",
    )
    writeFileSync(join(modulesDir, 'index.ts'), withProject)

    await removeModule({ name: 'hello', modulesDir, force: true })
    const removed = readFileSync(join(modulesDir, 'index.ts'), 'utf8')

    expect(removed.slice(removed.indexOf('defineModules()')).replace(/\s+/g, '')).toBe(
      'defineModules().mount(ProjectModule())',
    )
    expect(removed).not.toContain('HelloModule')
    expect(existsSync(join(modulesDir, 'hello'))).toBe(false)
    rmSync(modulesDir, { recursive: true, force: true })
  })
})

describe('modules index formatting', () => {
  it('kick g module leaves src/modules/index.ts formatted by the project oxfmt', async () => {
    const { autoRegisterModule } = await import('../src/generators/module')
    const { clearFormatCache, setFormatOnWrite } = await import('../src/utils/fs')
    const root = mkdtempSync(join(tmpdir(), 'kick-modules-fmt-'))
    writeFileSync(
      join(root, '.oxfmtrc.json'),
      readFileSync(resolve(__dirname, '../templates/base/files/_dot_oxfmtrc.json'), 'utf8'),
    )
    const modulesDir = join(root, 'src/modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, 'index.ts'), scaffolded)
    clearFormatCache()
    setFormatOnWrite(true)

    await autoRegisterModule(modulesDir, 'Project', 'projects', 'project')
    const two = readFileSync(join(modulesDir, 'index.ts'), 'utf8')
    expect(two).toContain(
      'export const modules = defineModules().mount(HelloModule()).mount(ProjectModule())\n',
    )

    await autoRegisterModule(modulesDir, 'Task', 'tasks', 'task')
    expect(readFileSync(join(modulesDir, 'index.ts'), 'utf8')).toContain(
      'export const modules = defineModules()\n  .mount(HelloModule())\n  .mount(ProjectModule())\n  .mount(TaskModule())\n',
    )
    rmSync(root, { recursive: true, force: true })
  })
})
