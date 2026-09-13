/**
 * `kick check --di`: REQUEST-scoped dependencies in singleton constructors
 * are found from source, and anything the scan cannot pin down stays silent.
 *
 * @module @forinda/kickjs-cli/__tests__/check-di.test
 */
import { describe, expect, it } from 'vitest'

import { findScopeMismatches, type SourceFile } from '../src/commands/check-di'

const tokens: SourceFile = {
  path: 'src/modules/reception/reception.tokens.ts',
  source: `export const RECEPTION_REPOSITORY = createToken<ReceptionRepository>('reception/repository')`,
}

const requestModule: SourceFile = {
  path: 'src/modules/reception/reception.module.ts',
  source: `
export const ReceptionModule = defineModule({
  name: 'ReceptionModule',
  build: () => ({
    register(container) {
      container.registerFactory(RECEPTION_REPOSITORY, () => createRepo(), Scope.REQUEST)
    },
    routes: () => ({ path: '/reception', controller: ReceptionController }),
  }),
})`,
}

const controller = (ctor: string): SourceFile => ({
  path: 'src/modules/reception/reception.controller.ts',
  source: `
@Controller()
export class ReceptionController {
  ${ctor}
}`,
})

describe('kick check --di', () => {
  it('flags a controller constructor injecting a REQUEST-scoped token (#676)', () => {
    const findings = findScopeMismatches([
      tokens,
      requestModule,
      controller(
        'constructor(@Inject(RECEPTION_REPOSITORY) private readonly repo: ReceptionRepository) {}',
      ),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      file: 'src/modules/reception/reception.controller.ts',
      line: 4,
      parent: 'ReceptionController',
      dependency: 'RECEPTION_REPOSITORY',
    })
    expect(findings[0].message).toContain('@Autowired()')
  })

  it('stays silent when the dependency is injected with @Autowired', () => {
    const findings = findScopeMismatches([
      tokens,
      requestModule,
      controller('@Autowired(RECEPTION_REPOSITORY) private readonly repo!: ReceptionRepository'),
    ])
    expect(findings).toEqual([])
  })

  it('resolves an un-annotated parameter by its class type', () => {
    const findings = findScopeMismatches([
      {
        path: 'src/tenant.ts',
        source: `@Service({ scope: Scope.REQUEST }) export class TenantContext {}`,
      },
      {
        path: 'src/reports.service.ts',
        source: `@Service() export class ReportsService { constructor(private tenant: TenantContext) {} }`,
      },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ parent: 'ReportsService', dependency: 'TenantContext' })
    expect(findings[0].message).toContain('TRANSIENT or REQUEST scope')
  })

  it('matches string-literal tokens', () => {
    const findings = findScopeMismatches([
      { path: 'src/app.ts', source: `container.registerFactory('tenant', () => t, 'request')` },
      controller(`constructor(@Inject('tenant') tenant: Tenant) {}`),
    ])
    expect(findings.map((f) => f.dependency)).toEqual(["'tenant'"])
  })

  it('does not flag a parent that is itself TRANSIENT or REQUEST scoped', () => {
    for (const scope of ['Scope.TRANSIENT', 'Scope.REQUEST']) {
      const findings = findScopeMismatches([
        tokens,
        requestModule,
        {
          path: 'src/reception.service.ts',
          source: `@Service({ scope: ${scope} }) export class ReceptionService {
            constructor(@Inject(RECEPTION_REPOSITORY) repo: ReceptionRepository) {}
          }`,
        },
      ])
      expect(findings).toEqual([])
    }
  })

  describe('silence when the scan cannot be sure', () => {
    it('a scope held in a variable', () => {
      const findings = findScopeMismatches([
        tokens,
        {
          path: 'src/app.ts',
          source: `container.registerFactory(RECEPTION_REPOSITORY, () => r, configuredScope)`,
        },
        controller('constructor(@Inject(RECEPTION_REPOSITORY) repo: ReceptionRepository) {}'),
      ])
      expect(findings).toEqual([])
    })

    it('a token registered under two scopes', () => {
      const findings = findScopeMismatches([
        tokens,
        requestModule,
        {
          path: 'src/testing-module.ts',
          source: `container.registerFactory(RECEPTION_REPOSITORY, () => r, Scope.SINGLETON)`,
        },
        controller('constructor(@Inject(RECEPTION_REPOSITORY) repo: ReceptionRepository) {}'),
      ])
      expect(findings).toEqual([])
    })

    it('a token name declared in two files', () => {
      const findings = findScopeMismatches([
        tokens,
        {
          path: 'src/other.tokens.ts',
          source: `export const RECEPTION_REPOSITORY = createToken('x')`,
        },
        requestModule,
        controller('constructor(@Inject(RECEPTION_REPOSITORY) repo: ReceptionRepository) {}'),
      ])
      expect(findings).toEqual([])
    })

    it('a file that does not parse', () => {
      expect(
        findScopeMismatches([{ path: 'src/broken.ts', source: '@Controller( export class {' }]),
      ).toEqual([])
    })
  })
})
