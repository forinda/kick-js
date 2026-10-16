import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  Application,
  Container,
  defineModule,
  defineSettings,
  loadEnv,
  resetEnvCache,
} from '../src/index'

beforeEach(() => Container.reset())
const flag = Symbol.for('kickjs.config.describe')
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[flag]
  resetEnvCache()
})

const Db = defineSettings(
  'KD_DB',
  z.object({
    url: z.string().url().describe('Postgres connection string'),
    pool: z.object({ max: z.coerce.number().default(10) }).default({ max: 10 }),
    replicas: z.array(z.string()).optional(),
  }),
)
const Mail = defineSettings('KD_MAIL', z.object({ host: z.string() }))

describe('app.describeConfig', () => {
  it('lists env and declared sections without reading or validating the environment', () => {
    // As `kick env example` loads the app: the schema is recorded, not
    // validated — SESSION_SECRET isn't set, and loading must not throw.
    ;(globalThis as Record<symbol, unknown>)[flag] = true
    loadEnv(
      z.object({
        PORT: z.coerce.number().default(3000),
        SESSION_SECRET: z.string().min(32).describe('Signs session cookies'),
      }),
    )
    const app = new Application({
      settings: [Db],
      modules: [{ settings: () => [Mail, Db], routes: () => null, name: 'MailModule' } as never],
    })

    const { env, sections } = app.describeConfig()
    expect(env).toEqual([
      { name: 'PORT', required: false, default: 3000, list: false },
      {
        name: 'SESSION_SECRET',
        required: true,
        description: 'Signs session cookies',
        list: false,
      },
    ])
    expect(sections).toEqual([
      {
        prefix: 'KD_DB',
        declaredBy: 'app',
        vars: [
          {
            name: 'KD_DB_URL',
            required: true,
            description: 'Postgres connection string',
            list: false,
          },
          // A defaulted parent supplies its children.
          { name: 'KD_DB_POOL_MAX', required: false, default: 10, list: false },
          { name: 'KD_DB_REPLICAS', required: false, list: true },
        ],
      },
      // Declared again by the module: listed once.
      {
        prefix: 'KD_MAIL',
        declaredBy: 'module MailModule',
        vars: [{ name: 'KD_MAIL_HOST', required: true, list: false }],
      },
    ])
  })

  it('labels a defineModule module by its declared name, not "Object"', () => {
    const MailModule = defineModule({
      name: 'Mail',
      build: () => ({ routes: () => null, settings: () => [Mail] }),
    })
    const app = new Application({ modules: [MailModule(), MailModule.scoped('eu')] as never })
    expect(app.describeConfig().sections.map((s) => s.declaredBy)).toEqual(['module Mail'])
  })
})
