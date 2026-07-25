import { describe, it, expect, beforeEach } from 'vitest'
import {
  Container,
  HttpException,
  MissingContextValueError,
  defineContextDecorator,
} from '@forinda/kickjs'
import { Code, ConnectError, createClient, createRouterTransport } from '@connectrpc/connect'
import {
  GrpcMethod,
  GrpcService,
  INTERNAL_ERROR_MESSAGE,
  buildConnectRoutes,
  codeForStatus,
  collectServices,
  grpcServiceRegistry,
  toConnectError,
  type GrpcContext,
  type GrpcServiceEntry,
} from '../src/index'
import { EchoService } from './fixtures/echo-service'

/**
 * Build the pieces `buildConnectRoutes` needs from a decorated class, without
 * going through the module-level registry — keeps each test isolated from
 * decorator side effects in the others.
 */
function entryFor(serviceClass: any): GrpcServiceEntry {
  const found = collectServices().find((e) => e.serviceClass === serviceClass)
  if (!found) throw new Error(`${serviceClass.name} not in registry`)
  return found
}

function clientFor(entries: GrpcServiceEntry[], container = Container.getInstance()) {
  const routes = buildConnectRoutes({ container, entries })
  return createClient(EchoService, createRouterTransport(routes)) as any
}

/** Register a class with the container if the decorator queue hasn't yet. */
function ensureRegistered(cls: any): void {
  const container = Container.getInstance()
  if (!container.has(cls)) container.register(cls, cls)
}

beforeEach(() => {
  Container.reset()
})

describe('@GrpcService / @GrpcMethod', () => {
  it('registers the class, its descriptor, and its handlers', () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(req: any) {
        return { text: req.text }
      }
    }

    expect(grpcServiceRegistry.has(Svc)).toBe(true)

    const entry = entryFor(Svc)
    expect(entry.descriptor.typeName).toBe('test.v1.EchoService')
    expect(entry.handlers).toEqual([{ rpc: 'echo', handlerName: 'echo' }])
  })

  it('accepts the proto RPC name as well as the generated localName', () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod('Echo')
      handleEcho(req: any) {
        return { text: req.text }
      }
    }
    ensureRegistered(Svc)

    expect(entryFor(Svc).handlers).toEqual([{ rpc: 'Echo', handlerName: 'handleEcho' }])
    // Resolving through the descriptor is what proves the alias works.
    expect(() =>
      buildConnectRoutes({ container: Container.getInstance(), entries: [entryFor(Svc)] }),
    ).not.toThrow()
  })

  it('fails at build time when the RPC is not in the descriptor', () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod('nope')
      whatever() {
        return {}
      }
    }

    expect(() =>
      buildConnectRoutes({ container: Container.getInstance(), entries: [entryFor(Svc)] }),
    ).toThrow(/Unknown RPC "nope"/)
  })
})

describe('unary RPCs', () => {
  it('resolves the handler through DI and passes a GrpcContext', async () => {
    let seen: GrpcContext | undefined

    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(req: any, ctx: GrpcContext) {
        seen = ctx
        return { text: `echo:${req.text}` }
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    const res = await client.echo({ text: 'hi' })

    expect(res.text).toBe('echo:hi')
    expect(seen).toBeDefined()
    expect(seen!.service).toBe('test.v1.EchoService')
    expect(seen!.method).toBe('Echo')
    expect(seen!.protocol).toBeTypeOf('string')
    expect(seen!.requestId).toBeTypeOf('string')
  })

  it('answers RPCs declared in the proto but not implemented with Unimplemented', async () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(req: any) {
        return { text: req.text }
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    const received: unknown[] = []
    let err: unknown

    try {
      for await (const msg of client.echoStream({ text: 'x' })) received.push(msg)
    } catch (e) {
      err = e
    }

    expect(received).toEqual([])
    expect(ConnectError.from(err).code).toBe(Code.Unimplemented)
  })
})

describe('server-streaming RPCs', () => {
  it('streams messages and runs contributors before the first one', async () => {
    const order: string[] = []

    const Tag = defineContextDecorator({
      key: 'tag',
      resolve: () => {
        order.push('contributor')
        return 'tagged'
      },
    })

    @GrpcService(EchoService)
    class Svc {
      @Tag
      @GrpcMethod()
      async *echoStream(req: any, ctx: GrpcContext) {
        order.push('handler')
        yield { text: `${req.text}:${ctx.require('tag')}:1` }
        yield { text: `${req.text}:${ctx.require('tag')}:2` }
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    const out: string[] = []
    for await (const msg of client.echoStream({ text: 'a' })) out.push(msg.text)

    expect(out).toEqual(['a:tagged:1', 'a:tagged:2'])
    expect(order).toEqual(['contributor', 'handler'])
  })
})

describe('context contributors', () => {
  it('populates ctx via the shared pipeline, with method beating class', async () => {
    const AtClass = defineContextDecorator({ key: 'who', resolve: () => 'class' })
    const AtMethod = defineContextDecorator({ key: 'who', resolve: () => 'method' })

    @AtClass
    @GrpcService(EchoService)
    class Svc {
      @AtMethod
      @GrpcMethod()
      echo(_req: any, ctx: GrpcContext) {
        return { text: ctx.require('who') }
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    expect((await client.echo({ text: '' })).text).toBe('method')
  })

  it('applies class-level contributors when no method-level one claims the key', async () => {
    const AtClass = defineContextDecorator({ key: 'who', resolve: () => 'class' })

    @AtClass
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(_req: any, ctx: GrpcContext) {
        return { text: ctx.require('who') }
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    expect((await client.echo({ text: '' })).text).toBe('class')
  })

  it('surfaces a missing required key as Internal, not as a caller error', async () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(_req: any, ctx: GrpcContext) {
        return { text: ctx.require('never-set') }
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    const err = await client.echo({ text: '' }).catch((e: unknown) => e)
    expect(ConnectError.from(err).code).toBe(Code.Internal)
  })
})

describe('error mapping', () => {
  it('maps HTTP statuses to Connect codes', () => {
    expect(codeForStatus(400)).toBe(Code.InvalidArgument)
    expect(codeForStatus(401)).toBe(Code.Unauthenticated)
    expect(codeForStatus(403)).toBe(Code.PermissionDenied)
    expect(codeForStatus(404)).toBe(Code.NotFound)
    expect(codeForStatus(409)).toBe(Code.AlreadyExists)
    expect(codeForStatus(422)).toBe(Code.InvalidArgument)
    expect(codeForStatus(429)).toBe(Code.ResourceExhausted)
    expect(codeForStatus(503)).toBe(Code.Unavailable)
    // Unlisted statuses fall back by class.
    expect(codeForStatus(418)).toBe(Code.Unknown)
    expect(codeForStatus(507)).toBe(Code.Internal)
  })

  it('passes an existing ConnectError through untouched', () => {
    const original = new ConnectError('nope', Code.PermissionDenied)
    expect(toConnectError(original)).toBe(original)
  })

  it('hides non-HTTP errors behind Internal but keeps the cause', () => {
    const boom = new Error('db exploded')
    const mapped = toConnectError(boom)
    expect(mapped.code).toBe(Code.Internal)
    expect(mapped.cause).toBe(boom)
    // The message must NOT survive — it routinely carries connection
    // strings, SQL, and absolute paths.
    expect(mapped.rawMessage).toBe(INTERNAL_ERROR_MESSAGE)
    expect(mapped.rawMessage).not.toContain('db exploded')
  })

  it('redacts non-Error throws too', () => {
    const mapped = toConnectError('postgres://user:hunter2@db.internal/prod')
    expect(mapped.code).toBe(Code.Internal)
    expect(mapped.rawMessage).toBe(INTERNAL_ERROR_MESSAGE)
    expect(mapped.rawMessage).not.toContain('hunter2')
    expect(mapped.cause).toBe('postgres://user:hunter2@db.internal/prod')
  })

  it('redacts a missing-context failure — it is a server wiring bug', () => {
    const mapped = toConnectError(new MissingContextValueError('tenant'))
    expect(mapped.code).toBe(Code.Internal)
    expect(mapped.rawMessage).toBe(INTERNAL_ERROR_MESSAGE)
    expect(mapped.cause).toBeInstanceOf(MissingContextValueError)
  })

  it('does not leak an internal message over the wire end-to-end', async () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(): never {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    const err = await client.echo({ text: '' }).catch((e: unknown) => e)
    const connectErr = ConnectError.from(err)

    expect(connectErr.code).toBe(Code.Internal)
    expect(connectErr.rawMessage).toBe(INTERNAL_ERROR_MESSAGE)
    expect(connectErr.rawMessage).not.toContain('10.0.0.5')
  })

  it('still surfaces a deliberate HttpException message — that is the point of raising one', () => {
    const mapped = toConnectError(HttpException.notFound('no such user'))
    expect(mapped.code).toBe(Code.NotFound)
    expect(mapped.rawMessage).toBe('no such user')
  })

  it('maps a thrown HttpException across the wire', async () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(): never {
        throw HttpException.notFound('no such user')
      }
    }
    ensureRegistered(Svc)

    const client = clientFor([entryFor(Svc)])
    const err = await client.echo({ text: '' }).catch((e: unknown) => e)
    const connectErr = ConnectError.from(err)

    expect(connectErr.code).toBe(Code.NotFound)
    expect(connectErr.rawMessage).toContain('no such user')
  })

  it('lets onError rewrite the failure', async () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(): never {
        throw new Error('leaky internal detail')
      }
    }
    ensureRegistered(Svc)

    const routes = buildConnectRoutes({
      container: Container.getInstance(),
      entries: [entryFor(Svc)],
      onError: () => new ConnectError('try later', Code.Unavailable),
    })
    const client = createClient(EchoService, createRouterTransport(routes)) as any

    const err = await client.echo({ text: '' }).catch((e: unknown) => e)
    expect(ConnectError.from(err).code).toBe(Code.Unavailable)
    expect(ConnectError.from(err).rawMessage).toBe('try later')
  })
})

describe('call accounting', () => {
  it('reports successes and failures per method', async () => {
    @GrpcService(EchoService)
    class Svc {
      @GrpcMethod()
      echo(req: any) {
        if (req.text === 'boom') throw HttpException.badRequest('bad')
        return { text: req.text }
      }
    }
    ensureRegistered(Svc)

    const calls: string[] = []
    const failures: string[] = []
    const routes = buildConnectRoutes({
      container: Container.getInstance(),
      entries: [entryFor(Svc)],
      onCall: (k) => calls.push(k),
      onFailure: (k) => failures.push(k),
    })
    const client = createClient(EchoService, createRouterTransport(routes)) as any

    await client.echo({ text: 'ok' })
    await client.echo({ text: 'boom' }).catch(() => {})

    expect(calls).toEqual(['test.v1.EchoService/Echo', 'test.v1.EchoService/Echo'])
    expect(failures).toEqual(['test.v1.EchoService/Echo'])
  })
})
