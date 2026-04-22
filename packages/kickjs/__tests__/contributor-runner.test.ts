import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Container,
  Scope,
  buildPipeline,
  createToken,
  defineContextDecorator,
  runContributors,
  type ContributorPipeline,
  type ExecutionContext,
  type SourcedRegistration,
} from '../src/core'

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal in-memory ExecutionContext for runner tests.
 * Records `set` order so tests can assert sequential execution.
 */
function makeCtx() {
  const store = new Map<string, unknown>()
  const writes: Array<{ key: string; value: unknown }> = []
  const ctx: ExecutionContext = {
    get<K extends string>(key: K) {
      return store.get(key) as never
    },
    set<K extends string>(key: K, value: never) {
      store.set(key, value)
      writes.push({ key, value })
    },
    requestId: 'req-runner-test',
  }
  return { ctx, store, writes }
}

function pipelineOf(...sources: SourcedRegistration[]): ContributorPipeline {
  return buildPipeline(sources)
}

beforeEach(() => {
  Container.reset()
})

// ── Happy path ──────────────────────────────────────────────────────────

describe('runContributors — sequential execution', () => {
  it('runs an empty pipeline cleanly with no writes', async () => {
    const { ctx, writes } = makeCtx()
    const pipeline = buildPipeline([])

    await runContributors({ pipeline, ctx, container: Container.getInstance() })

    expect(writes).toEqual([])
  })

  it('runs contributors in topo order, each visible to the next via ctx.get', async () => {
    const { ctx, writes } = makeCtx()
    const seenByProject: unknown[] = []

    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    const LoadProject = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant'],
      resolve: (innerCtx) => {
        seenByProject.push(innerCtx.get('tenant'))
        return { id: 'p-1' }
      },
    })

    const pipeline = pipelineOf(
      { source: 'method', registration: LoadProject.registration },
      { source: 'method', registration: LoadTenant.registration },
    )

    await runContributors({ pipeline, ctx, container: Container.getInstance() })

    expect(writes.map((w) => w.key)).toEqual(['tenant', 'project'])
    expect(seenByProject).toEqual([{ id: 't-1' }])
  })

  it('awaits async resolve before moving to the next contributor', async () => {
    const { ctx, writes } = makeCtx()

    const SlowFirst = defineContextDecorator({
      key: 'slow',
      resolve: async () => {
        await new Promise((r) => setTimeout(r, 10))
        return 'slow-value'
      },
    })
    const FastSecond = defineContextDecorator({
      key: 'fast',
      dependsOn: ['slow'],
      resolve: (innerCtx) => `${innerCtx.get('slow') as string}-then-fast`,
    })

    await runContributors({
      pipeline: pipelineOf(
        { source: 'method', registration: SlowFirst.registration },
        { source: 'method', registration: FastSecond.registration },
      ),
      ctx,
      container: Container.getInstance(),
    })

    expect(writes.map((w) => w.value)).toEqual(['slow-value', 'slow-value-then-fast'])
  })
})

// ── DI deps ─────────────────────────────────────────────────────────────

describe('runContributors — DI deps', () => {
  it('resolves declared deps from the container and passes them to resolve()', async () => {
    const NAME = createToken<string>('greeting.name')
    const container = Container.getInstance()
    container.registerInstance(NAME, 'world')

    const { ctx, store } = makeCtx()
    const Greet = defineContextDecorator({
      key: 'greeting',
      deps: { name: NAME },
      resolve: (_innerCtx, { name }) => `hello, ${name as string}`,
    })

    await runContributors({
      pipeline: pipelineOf({ source: 'method', registration: Greet.registration }),
      ctx,
      container,
    })

    expect(store.get('greeting')).toBe('hello, world')
  })

  it('passes an empty deps object when none are declared', async () => {
    const { ctx, store } = makeCtx()
    let receivedDeps: unknown
    const Empty = defineContextDecorator({
      key: 'empty',
      resolve: (_innerCtx, deps) => {
        receivedDeps = deps
        return 'ok'
      },
    })

    await runContributors({
      pipeline: pipelineOf({ source: 'method', registration: Empty.registration }),
      ctx,
      container: Container.getInstance(),
    })

    expect(receivedDeps).toEqual({})
    expect(store.get('empty')).toBe('ok')
  })

  it('treats a missing-DI throw as a resolve-side error (subject to optional/onError)', async () => {
    const MISSING = createToken<string>('missing.token')
    const { ctx } = makeCtx()
    const NeedsMissing = defineContextDecorator({
      key: 'will-throw',
      deps: { x: MISSING },
      resolve: (_innerCtx, _deps) => 'unreachable',
    })

    await expect(
      runContributors({
        pipeline: pipelineOf({
          source: 'method',
          registration: NeedsMissing.registration,
        }),
        ctx,
        container: Container.getInstance(),
      }),
    ).rejects.toThrow()
  })
})

// ── Error matrix (architecture.md §20.9) ────────────────────────────────

describe('runContributors — error matrix', () => {
  it('case 1 — resolve throws + optional=true → skip, key unset, pipeline continues', async () => {
    const { ctx, store } = makeCtx()

    const Failing = defineContextDecorator({
      key: 'fail',
      optional: true,
      resolve: () => {
        throw new Error('boom')
      },
    })
    const After = defineContextDecorator({
      key: 'after',
      resolve: () => 'ran',
    })

    await runContributors({
      pipeline: pipelineOf(
        { source: 'method', registration: Failing.registration },
        { source: 'method', registration: After.registration },
      ),
      ctx,
      container: Container.getInstance(),
    })

    expect(store.has('fail')).toBe(false)
    expect(store.get('after')).toBe('ran')
  })

  it('case 2 — resolve throws + onError returns replacement → key gets the replacement', async () => {
    const { ctx, store } = makeCtx()

    const FailWithFallback = defineContextDecorator<'cached', Record<string, never>>({
      key: 'cached',
      resolve: () => {
        throw new Error('upstream down')
      },
      onError: () => 'fallback-value',
    })

    await runContributors({
      pipeline: pipelineOf({ source: 'method', registration: FailWithFallback.registration }),
      ctx,
      container: Container.getInstance(),
    })

    expect(store.get('cached')).toBe('fallback-value')
  })

  it('case 3 — resolve throws + onError returns void → key remains unset', async () => {
    const { ctx, store } = makeCtx()

    const FailNoFallback = defineContextDecorator({
      key: 'maybe',
      resolve: () => {
        throw new Error('boom')
      },
      onError: () => undefined,
    })

    await runContributors({
      pipeline: pipelineOf({ source: 'method', registration: FailNoFallback.registration }),
      ctx,
      container: Container.getInstance(),
    })

    expect(store.has('maybe')).toBe(false)
  })

  it('case 4 — resolve throws + no onError + optional=false → propagates the original error', async () => {
    const { ctx } = makeCtx()

    const Hard = defineContextDecorator({
      key: 'hard',
      resolve: () => {
        throw new Error('hard fail')
      },
    })

    await expect(
      runContributors({
        pipeline: pipelineOf({ source: 'method', registration: Hard.registration }),
        ctx,
        container: Container.getInstance(),
      }),
    ).rejects.toThrow('hard fail')
  })

  it('case 5 — onError throws → propagates the new error, original is lost', async () => {
    const { ctx } = makeCtx()

    const HookExplodes = defineContextDecorator({
      key: 'hook-bomb',
      resolve: () => {
        throw new Error('original')
      },
      onError: () => {
        throw new Error('hook explosion')
      },
    })

    await expect(
      runContributors({
        pipeline: pipelineOf({ source: 'method', registration: HookExplodes.registration }),
        ctx,
        container: Container.getInstance(),
      }),
    ).rejects.toThrow('hook explosion')
  })

  it('async onError is awaited', async () => {
    const { ctx, store } = makeCtx()

    const AsyncRecover = defineContextDecorator({
      key: 'recovered',
      resolve: () => {
        throw new Error('boom')
      },
      onError: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 'recovered-async'
      },
    })

    await runContributors({
      pipeline: pipelineOf({ source: 'method', registration: AsyncRecover.registration }),
      ctx,
      container: Container.getInstance(),
    })

    expect(store.get('recovered')).toBe('recovered-async')
  })

  it('does not call onError when resolve succeeds', async () => {
    const { ctx, store } = makeCtx()
    let hookCalled = false

    const Happy = defineContextDecorator({
      key: 'ok',
      resolve: () => 'fine',
      onError: () => {
        hookCalled = true
        return undefined
      },
    })

    await runContributors({
      pipeline: pipelineOf({ source: 'method', registration: Happy.registration }),
      ctx,
      container: Container.getInstance(),
    })

    expect(store.get('ok')).toBe('fine')
    expect(hookCalled).toBe(false)
  })
})
