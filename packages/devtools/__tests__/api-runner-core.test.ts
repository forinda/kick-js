import { runInNewContext } from 'node:vm'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  applyHints,
  editorLink,
  exampleFromSchema,
  historyLabel,
  openApiHints,
  loadEnvironments,
  moveRow,
  environmentFor,
  nextEnvironmentName,
  fillFromEnvironment,
  routeKey,
  routeHints,
  pushHistory,
  buildUrl,
  emptyInputs,
  formatBody,
  formatJson,
  needsConfirmation,
  pathParams,
  prepareRequest,
  interpolate,
  readJsonPath,
  storableInputs,
  unresolvedVariables,
  variableMap,
  publicFlagNames,
  readCookie,
  toCurl,
  toFetch,
  type KeyValueRow,
  type RouteInputs,
  type RunnerRoute,
  paramsFromPath,
} from '../spa/src/lib/api-runner-core'

const row = (key: string, value: string, enabled = true): KeyValueRow => ({ key, value, enabled })

function prepare(
  route: RunnerRoute,
  inputs: Partial<RouteInputs> = {},
  extra: { defaults?: KeyValueRow[]; cookies?: string } = {},
) {
  return prepareRequest({
    route,
    inputs: { ...emptyInputs(route), ...inputs },
    defaults: extra.defaults ?? [],
    settings: DEFAULT_SETTINGS,
    origin: 'http://localhost:3000',
    cookies: extra.cookies ?? '',
  })
}

describe('pathParams / buildUrl', () => {
  it('finds params in order without duplicates', () => {
    expect(pathParams('/api/v1/orgs/:orgId/users/:id/:orgId')).toEqual(['orgId', 'id'])
  })

  it('substitutes and encodes params, keeps empty ones visible, appends enabled query rows', () => {
    const url = buildUrl('http://x', '/api/v1/users/:id/files/:name', { id: 'a b', name: '' }, [
      row('q', 'x&y'),
      row('off', '1', false),
      row('', 'ignored'),
    ])
    expect(url).toBe('http://x/api/v1/users/a%20b/files/:name?q=x%26y')
  })
})

describe('prepareRequest', () => {
  it('merges default and route headers, route winning case-insensitively', () => {
    const req = prepare(
      { method: 'GET', path: '/api/v1/me' },
      { headers: [row('x-tenant', 'b')] },
      { defaults: [row('X-Tenant', 'a'), row('Authorization', 'Bearer t')] },
    )
    expect(req.headers).toEqual({ Authorization: 'Bearer t', 'x-tenant': 'b' })
  })

  it('drops the default Authorization on a route with the public flag, keeps a route-level one', () => {
    const route = { method: 'GET', path: '/api/v1/health', flags: { 'auth.public': true } }
    expect(prepare(route, {}, { defaults: [row('Authorization', 'Bearer t')] }).headers).toEqual({})
    expect(
      prepare(
        route,
        { headers: [row('authorization', 'Bearer x')] },
        { defaults: [row('Authorization', 'Bearer t')] },
      ).headers,
    ).toEqual({ authorization: 'Bearer x' })
  })

  it('sends the default headers a route ticks and leaves off those it unticks, flags or not', () => {
    const defaults = [row('Authorization', 'Bearer t'), row('X-Tenant', 'a')]
    const login = { method: 'POST', path: '/api/v1/login' }
    expect(
      prepare(login, { defaultHeaders: { authorization: false } }, { defaults }).headers,
    ).toEqual({ 'X-Tenant': 'a' })
    // A public route starts with Authorization off; ticking it sends it.
    const health = { method: 'GET', path: '/health', flags: { 'auth.public': true } }
    expect(
      prepare(health, { defaultHeaders: { authorization: true } }, { defaults }).headers,
    ).toEqual({ Authorization: 'Bearer t', 'X-Tenant': 'a' })
  })

  it('accepts several public flag names, as a list or a comma-separated string', () => {
    const defaults = [row('Authorization', 'Bearer t')]
    const route = { method: 'GET', path: '/x', flags: { public: true } }
    for (const publicFlag of [['auth.public', 'public'], 'auth.public, public']) {
      const req = prepareRequest({
        route,
        inputs: emptyInputs(route),
        defaults,
        settings: { ...DEFAULT_SETTINGS, publicFlag },
        origin: 'http://x',
        cookies: '',
      })
      expect(req.headers).toEqual({})
    }
    expect(publicFlagNames(' a, ,b ')).toEqual(['a', 'b'])
  })

  it('adds the CSRF header from the cookie on unsafe methods only', () => {
    const cookies = 'a=1; _csrf=tok%3D; b=2'
    expect(prepare({ method: 'POST', path: '/x' }, {}, { cookies }).headers['x-csrf-token']).toBe(
      'tok=',
    )
    expect(prepare({ method: 'GET', path: '/x' }, {}, { cookies }).headers).toEqual({})
  })

  it('sends a body only for body methods, and marks JSON', () => {
    const post = prepare({ method: 'POST', path: '/x' }, { body: '{"n":1}' })
    expect(post.body).toBe('{"n":1}')
    expect(post.headers['Content-Type']).toBe('application/json')
    expect(prepare({ method: 'GET', path: '/x' }, { body: '{"n":1}' }).body).toBeUndefined()
    expect(prepare({ method: 'POST', path: '/x' }, { body: 'plain' }).headers).toEqual({})
  })
})

describe('variables', () => {
  it('interpolate fills known {{names}} and leaves unknown ones visible', () => {
    expect(interpolate('Bearer {{ token }} / {{missing}}', { token: 'abc' })).toBe(
      'Bearer abc / {{missing}}',
    )
  })

  it('prepareRequest fills variables in params, query, headers and body', () => {
    const route = { method: 'POST', path: '/api/v1/orgs/:org' }
    const req = prepareRequest({
      route,
      inputs: {
        params: { org: '{{org}}' },
        query: [row('{{qk}}', '{{qv}}')],
        headers: [row('x-tenant', '{{org}}')],
        body: '{"owner":"{{user}}"}',
      },
      defaults: [row('Authorization', 'Bearer {{token}}')],
      settings: DEFAULT_SETTINGS,
      origin: 'http://x',
      cookies: '',
      variables: variableMap([
        row('org', 'acme'),
        row('qk', 'page'),
        row('qv', '2'),
        row('token', 't1'),
        row('user', 'u9'),
        row('off', 'x', false),
      ]),
    })
    expect(req.url).toBe('http://x/api/v1/orgs/acme?page=2')
    expect(req.headers).toEqual({
      Authorization: 'Bearer t1',
      'x-tenant': 'acme',
      'Content-Type': 'application/json',
    })
    expect(req.body).toBe('{"owner":"u9"}')
    expect(unresolvedVariables(req)).toEqual([])
  })

  it('reports variables nothing resolves', () => {
    const req = prepare(
      { method: 'GET', path: '/x' },
      {},
      { defaults: [row('Authorization', 'Bearer {{token}}')] },
    )
    expect(unresolvedVariables(req)).toEqual(['token'])
  })

  it('readJsonPath reads dotted paths with indexes', () => {
    const body = { data: { token: 'abc', user: { id: 7 } }, items: [{ id: 'first' }] }
    expect(readJsonPath(body, 'data.token')).toBe('abc')
    expect(readJsonPath(body, 'items[0].id')).toBe('first')
    expect(readJsonPath(body, 'data.user')).toBe('{"id":7}')
    expect(readJsonPath(body, 'data.nope.deeper')).toBeUndefined()
  })
})

describe('multipart form bodies', () => {
  const route = {
    method: 'POST',
    path: '/api/v1/avatars',
    upload: { mode: 'single' as const, fieldName: 'avatar' },
  }
  const file = new File([new Uint8Array([0xff, 0x00, 0xfe])], 'pic.png', { type: 'image/png' })
  const inputs = (): RouteInputs => ({
    ...emptyInputs(route),
    form: [
      { key: 'note', value: 'hi {{who}}', enabled: true, type: 'text' },
      { key: 'avatar', value: '', enabled: true, type: 'file', files: [file] },
      { key: 'off', value: 'x', enabled: false, type: 'text' },
    ],
  })

  it('an @FileUpload route starts in form mode with its declared field', () => {
    expect(emptyInputs(route)).toMatchObject({
      bodyMode: 'form',
      form: [{ key: 'avatar', type: 'file', enabled: true }],
    })
    expect(emptyInputs({ method: 'POST', path: '/x' }).bodyMode).toBe('raw')
  })

  it('builds FormData with text (variables filled) and file parts, and no Content-Type', async () => {
    const req = prepareRequest({
      route,
      inputs: inputs(),
      defaults: [row('Content-Type', 'application/json')],
      settings: DEFAULT_SETTINGS,
      origin: 'http://x',
      cookies: '',
      variables: { who: 'kick' },
    })
    expect(req.body).toBeInstanceOf(FormData)
    const body = req.body as FormData
    expect(body.get('note')).toBe('hi kick')
    const sent = body.get('avatar') as File
    expect(sent.name).toBe('pic.png')
    expect([...new Uint8Array(await sent.arrayBuffer())]).toEqual([0xff, 0x00, 0xfe])
    expect(body.has('off')).toBe(false)
    expect(req.headers).toEqual({})
    expect(req.form).toEqual([
      { name: 'note', value: 'hi kick' },
      { name: 'avatar', fileName: 'pic.png' },
    ])
  })

  it('renders -F parts in curl and a FormData block in fetch', () => {
    const req = prepare(route, inputs())
    expect(toCurl(req)).toBe(
      [
        `curl -X POST 'http://localhost:3000/api/v1/avatars'`,
        `-F 'note=hi {{who}}'`,
        `-F 'avatar=@pic.png'`,
      ].join(' \\\n  '),
    )

    const appended: unknown[] = []
    const calls: unknown[] = []
    class FormDataStub {
      append(...args: unknown[]) {
        appended.push(args)
      }
    }
    runInNewContext(toFetch(req).replace('await fetch', 'fetch'), {
      FormData: FormDataStub,
      fileInput: { files: ['<file>'] },
      fetch: (url: string, init: { method: string; body: unknown }) =>
        calls.push({ url, method: init.method, isForm: init.body instanceof FormDataStub }),
    })
    expect(appended).toEqual([
      ['note', 'hi {{who}}'],
      ['avatar', '<file>'],
    ])
    expect(calls).toEqual([
      { url: 'http://localhost:3000/api/v1/avatars', method: 'POST', isForm: true },
    ])
  })

  it('reports {{variables}} left unresolved in form fields', () => {
    const req = prepare(route, {
      form: [{ key: 'note', value: 'by {{author}}', enabled: true, type: 'text' }],
    })
    expect(unresolvedVariables(req)).toEqual(['author'])
  })

  it('drops picked files from stored inputs', () => {
    const stored = storableInputs(inputs())
    expect(stored.form?.[1]).toEqual({ key: 'avatar', value: '', enabled: true, type: 'file' })
    expect(JSON.parse(JSON.stringify(stored)).form).toHaveLength(3)
  })
})

describe('snippets', () => {
  const req = {
    method: 'POST',
    url: "http://x/api/v1/notes?q=it's",
    headers: { 'Content-Type': 'application/json' },
    body: `{"text":"it's"}`,
  }

  it('toCurl quotes single quotes for POSIX shells', () => {
    expect(toCurl(req)).toBe(
      [
        `curl -X POST 'http://x/api/v1/notes?q=it'\\''s'`,
        `-H 'Content-Type: application/json'`,
        `--data-raw '{"text":"it'\\''s"}'`,
      ].join(' \\\n  '),
    )
  })

  it('toFetch is valid JavaScript with the same request', () => {
    // Run the snippet in an isolated context whose only global is a fetch stub.
    const captured: unknown[] = []
    runInNewContext(toFetch(req).replace(/^await /, ''), {
      fetch: (...args: unknown[]) => captured.push(JSON.parse(JSON.stringify(args))),
    })
    expect(captured[0]).toEqual([req.url, { method: 'POST', headers: req.headers, body: req.body }])
  })
})

describe('helpers', () => {
  it('readCookie finds exact names only', () => {
    expect(readCookie('x_csrf=1; _csrf=2', '_csrf')).toBe('2')
    expect(readCookie('', '_csrf')).toBeUndefined()
  })

  it('formatBody pretty-prints JSON and leaves the rest alone', () => {
    expect(formatBody('{"a":1}', 'application/json; charset=utf-8')).toBe('{\n  "a": 1\n}')
    expect(formatBody('{bad', 'application/json')).toBe('{bad')
    expect(formatBody('<p>', 'text/html')).toBe('<p>')
  })

  it('asks for confirmation on data-changing methods', () => {
    expect(['DELETE', 'put', 'PATCH'].map(needsConfirmation)).toEqual([true, true, true])
    expect(['GET', 'POST'].map(needsConfirmation)).toEqual([false, false])
  })
})

describe('history', () => {
  const entry = (n: number) => ({
    at: n,
    method: 'GET',
    path: '/users/:id',
    inputs: { ...emptyInputs({ method: 'GET', path: '/users/:id' }), params: { id: String(n) } },
    status: 200,
  })

  it('keeps the newest entries first, capped', () => {
    let list = [entry(1)]
    for (let n = 2; n <= 5; n++) list = pushHistory(list, entry(n), 3)
    expect(list.map((e) => e.at)).toEqual([5, 4, 3])
  })

  it('drops picked files, and labels entries by path and query', () => {
    const file = new File(['x'], 'a.png')
    const [saved] = pushHistory([], {
      ...entry(1),
      inputs: {
        ...entry(1).inputs,
        query: [row('q', '{{term}}')],
        form: [{ key: 'f', value: '', enabled: true, type: 'file', files: [file] }],
      },
    })
    expect(saved.inputs.form?.[0].files).toBeUndefined()
    expect(historyLabel(saved)).toBe('/users/1?q=%7B%7Bterm%7D%7D')
  })
})

describe('OpenAPI hints', () => {
  const spec = {
    paths: {
      '/api/v1/users/{id}': {
        patch: {
          summary: 'Update a user',
          parameters: [
            { name: 'id', in: 'path', required: true, description: 'User id (uuid)' },
            { $ref: '#/components/parameters/Verbose' },
            { name: 'page', in: 'query' },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
        },
      },
    },
    components: {
      parameters: {
        Verbose: { name: 'verbose', in: 'query', required: true, description: 'More fields' },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Ada' },
            role: { type: 'string', enum: ['admin', 'user'] },
            age: { type: ['integer', 'null'] },
            tags: { type: 'array', items: { type: 'string' } },
            address: { allOf: [{ properties: { city: { type: 'string', default: 'Nairobi' } } }] },
            active: { type: 'boolean' },
          },
        },
      },
    },
  }
  const route = { method: 'PATCH', path: '/api/v1/users/:id' }

  it('reads the matching operation', () => {
    expect(openApiHints(spec, route)).toEqual({
      summary: 'Update a user',
      params: { id: 'User id (uuid)' },
      query: [
        { name: 'verbose', required: true, description: 'More fields' },
        { name: 'page', required: false, description: undefined },
      ],
      body: JSON.stringify(
        {
          name: 'Ada',
          role: 'admin',
          age: 0,
          tags: [''],
          address: { city: 'Nairobi' },
          active: false,
        },
        null,
        2,
      ),
    })
    expect(openApiHints(spec, { method: 'GET', path: '/api/v1/users/:id' })).toBeUndefined()
    expect(openApiHints(null, route)).toBeUndefined()
  })

  it('stops on a self-referencing schema', () => {
    const loop = { components: { schemas: { Node: { $ref: '#/components/schemas/Node' } } } }
    expect(() => exampleFromSchema(loop, { $ref: '#/components/schemas/Node' })).not.toThrow()
  })

  it('fills only what is empty', () => {
    const hints = openApiHints(spec, route)!
    const filled = applyHints({ ...emptyInputs(route), query: [row('page', '2')], body: '' }, hints)
    expect(filled.query).toEqual([row('page', '2'), row('verbose', '', true)])
    expect(JSON.parse(filled.body).name).toBe('Ada')

    const kept = applyHints({ ...emptyInputs(route), body: '{"x":1}' }, hints)
    expect(kept.body).toBe('{"x":1}')
    expect(kept.query.map((r) => [r.key, r.enabled])).toEqual([
      ['verbose', true],
      ['page', false],
    ])
  })
})

describe('editorLink', () => {
  it('fills the template, keeping Windows paths valid in a URL', () => {
    expect(editorLink(DEFAULT_SETTINGS.editorUrl, '/home/me/app/src/a b.ts', 12)).toBe(
      'vscode://file/home/me/app/src/a%20b.ts:12',
    )
    expect(editorLink('cursor://file{file}:{line}', 'C:\\app\\src\\a.ts', 3)).toBe(
      'cursor://file/C:/app/src/a.ts:3',
    )
  })
})

describe('paramsFromPath', () => {
  it('reads each param from a concrete path', () => {
    expect(
      paramsFromPath('/api/v1/users/:id/posts/:postId', '/api/v1/users/7/posts/a%20b'),
    ).toEqual({
      id: '7',
      postId: 'a b',
    })
  })

  it('is empty when the path does not fit the pattern', () => {
    expect(paramsFromPath('/users/:id', '/teams/7')).toEqual({})
    expect(paramsFromPath('/a.b/:id', '/axb/1')).toEqual({})
  })
})

describe("routeHints — from the route's own schemas", () => {
  it('builds the body example and the query rows', () => {
    const route = {
      method: 'POST',
      path: '/tasks',
      schemas: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            done: { type: 'boolean', default: false },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        query: {
          type: 'object',
          properties: {
            notify: { type: 'boolean', description: 'Email the team' },
            lang: { type: 'string' },
          },
          required: ['notify'],
        },
        params: { type: 'object', properties: { id: { type: 'string', description: 'Task id' } } },
      },
    }
    expect(routeHints(route)).toEqual({
      params: { id: 'Task id' },
      query: [
        { name: 'notify', required: true, description: 'Email the team' },
        { name: 'lang', required: false },
      ],
      body: JSON.stringify({ title: '', done: false, tags: [''] }, null, 2),
    })
  })

  it('resolves $defs inside the body schema', () => {
    const body = {
      type: 'object',
      properties: { owner: { $ref: '#/$defs/user' } },
      $defs: { user: { type: 'object', properties: { name: { type: 'string' } } } },
    }
    expect(
      JSON.parse(routeHints({ method: 'POST', path: '/x', schemas: { body } })!.body!),
    ).toEqual({
      owner: { name: '' },
    })
  })

  it('is nothing without schemas', () => {
    expect(routeHints({ method: 'GET', path: '/x' })).toBeUndefined()
  })
})

describe('environments', () => {
  const row = (key: string, value: string) => ({ key, value, enabled: true })
  const route = { method: 'GET', path: '/api/v1/orgs/:tenantId/users/:id' }

  it('starts with one dev environment holding the old headers and variables', () => {
    const legacy = {
      headers: [row('Authorization', 'Bearer {{token}}')],
      variables: [row('token', 't')],
    }
    expect(loadEnvironments(null, legacy)).toEqual({
      environments: [{ id: 'dev', name: 'dev', ...legacy, mappings: [] }],
      activeId: 'dev',
      pins: {},
    })
    expect(loadEnvironments({ environments: 'nope' }, legacy).environments).toHaveLength(1)
  })

  it('drops pins and an active id that point at no environment', () => {
    const state = loadEnvironments(
      {
        environments: [{ id: 'a', name: 'dev' }],
        activeId: 'gone',
        pins: { 'GET /x': 'a', 'GET /y': 'gone' },
      },
      { headers: [], variables: [] },
    )
    expect(state.activeId).toBe('a')
    expect(state.pins).toEqual({ 'GET /x': 'a' })
    expect(state.environments[0]).toMatchObject({ headers: [], variables: [], mappings: [] })
  })

  it('drops stored rows without a string key, string value and boolean enabled', () => {
    const ok = { key: 'a', value: '1', enabled: true }
    const state = loadEnvironments(
      {
        environments: [
          {
            id: 'a',
            name: 'dev',
            headers: [ok, { key: 'b', enabled: true }, { key: 'c', value: 2 }],
          },
        ],
      },
      { headers: [], variables: [] },
    )
    expect(state.environments[0]!.headers).toEqual([ok])
  })

  it('uses the pinned environment, else the active one', () => {
    const env = (id: string) => ({ id, name: id, headers: [], variables: [], mappings: [] })
    const state = { environments: [env('dev'), env('anon')], activeId: 'dev', pins: {} }
    expect(environmentFor(state, route).id).toBe('dev')
    expect(environmentFor({ ...state, pins: { [routeKey(route)]: 'anon' } }, route).id).toBe('anon')
    expect(routeKey(route)).toBe('GET /api/v1/orgs/:tenantId/users/:id')
  })

  it('names a new environment dev, stage, prod, then env N', () => {
    const named = (...names: string[]) => ({
      environments: names.map((name) => ({
        id: name,
        name,
        headers: [],
        variables: [],
        mappings: [],
      })),
      activeId: names[0]!,
      pins: {},
    })
    expect(nextEnvironmentName(named('dev'))).toBe('stage')
    expect(nextEnvironmentName(named('dev', 'stage', 'prod'))).toBe('env 4')
  })

  it('fills empty params and query values by name or mapping; what was typed wins', () => {
    const inputs = {
      ...emptyInputs(route),
      params: { tenantId: '', id: '42' },
      query: [row('lang', ''), row('page', '2'), { key: 'off', value: '', enabled: false }],
    }
    const vars = { orgId: 'acme', id: 'ignored', lang: 'en', off: 'x' }
    const filled = fillFromEnvironment(inputs, vars, [row('tenantId', 'orgId')])
    expect(filled.params).toEqual({ tenantId: 'acme', id: '42' })
    expect(filled.query).toEqual([
      row('lang', 'en'),
      row('page', '2'),
      { key: 'off', value: '', enabled: false },
    ])
    expect(inputs.params.tenantId).toBe('') // not written back
  })

  it('reaches the prepared request', () => {
    const req = prepareRequest({
      route,
      inputs: { ...emptyInputs(route), params: { tenantId: '', id: '7' } },
      defaults: [],
      variables: { orgId: 'acme' },
      mappings: [row('tenantId', 'orgId')],
      settings: DEFAULT_SETTINGS,
      origin: 'http://localhost:3000',
      cookies: '',
    })
    expect(req.url).toBe('http://localhost:3000/api/v1/orgs/acme/users/7')
  })
})

describe('moveRow', () => {
  it('moves an item to the target index, ignoring out-of-range moves', () => {
    expect(moveRow(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveRow(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveRow(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})

describe('formatJson', () => {
  it('pretty-prints JSON and declines anything else', () => {
    expect(formatJson('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}')
    expect(formatJson('{ "id": {{id}} }')).toBeUndefined()
  })
})
