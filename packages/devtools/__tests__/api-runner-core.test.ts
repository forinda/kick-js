import { runInNewContext } from 'node:vm'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  buildUrl,
  emptyInputs,
  formatBody,
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
