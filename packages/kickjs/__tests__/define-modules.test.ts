import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  defineModule,
  defineModules,
  ModuleList,
  type AppModule,
  type AppModuleEntry,
} from '../src/core'

const A = defineModule({ name: 'A', build: () => ({ routes: () => null }) })
const B = defineModule({ name: 'B', build: () => ({ routes: () => null }) })
const C = defineModule({ name: 'C', build: () => ({ routes: () => null }) })

describe('defineModules — fluent module list builder', () => {
  it('returns an empty ModuleList by default', () => {
    const list = defineModules()
    expect(list).toBeInstanceOf(ModuleList)
    expect(list).toBeInstanceOf(Array)
    expect(list.length).toBe(0)
  })

  it('accepts seed entries via varargs', () => {
    const list = defineModules(A(), B())
    expect(list.length).toBe(2)
  })

  it('.mount() appends and returns this for chaining', () => {
    const list = defineModules().mount(A()).mount(B()).mount(C())
    expect(list.length).toBe(3)
  })

  it('IS an Array<AppModuleEntry> — drops into bootstrap({ modules }) directly', () => {
    const list = defineModules().mount(A()).mount(B())
    // Type-level: the modules field is `AppModuleEntry[]`. ModuleList
    // extends Array<AppModuleEntry>, so it's structurally assignable
    // — no cast needed.
    const acceptArray: (modules: AppModuleEntry[]) => number = (modules) => modules.length
    expect(acceptArray(list)).toBe(2)
  })

  it('accepts both class form and defineModule factory output', () => {
    class LegacyModule implements AppModule {
      routes() {
        return null
      }
    }

    const list = defineModules().mount(LegacyModule).mount(A())
    expect(list.length).toBe(2)
    expect(typeof list[0]).toBe('function') // class
    expect(typeof list[1]).toBe('object') // factory output
  })

  it('seeded + chained composes naturally', () => {
    const list = defineModules(A()).mount(B()).mount(C())
    expect(list.length).toBe(3)
  })

  it('Array methods (forEach, map) iterate the appended modules', () => {
    const list = defineModules().mount(A()).mount(B())
    const seen: string[] = []
    list.forEach((entry) => {
      seen.push(typeof entry === 'function' ? entry.name : 'instance')
    })
    expect(seen).toEqual(['instance', 'instance'])
  })
})
