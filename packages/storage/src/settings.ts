/**
 * Bucket config as a settings section — `S3_BUCKET`, `S3_ACCESS_KEY_ID`, …,
 * validated when the app starts and listed by `kick env example`:
 *
 * ```ts
 * import { S3Settings, s3FromSettings } from '@forinda/kickjs-storage/settings'
 *
 * bootstrap({ modules, settings: [S3Settings] })
 * container.registerFactory(FILES, () => s3FromSettings())
 * ```
 *
 * A separate entry because it needs `@forinda/kickjs`; the drivers don't.
 *
 * @module @forinda/kickjs-storage/settings
 */
import { defineSettings, type Settings, type SettingsOf } from '@forinda/kickjs'
import type { KickSchema, SchemaIssue } from '@forinda/kickjs-schema'
import { s3Storage, type S3Storage, type S3StorageOptions } from './s3'

type S3Fields = {
  bucket: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  forcePathStyle?: boolean
}

// The keys come as a pair, or not at all: without them, s3FromSettings needs `credentials`.
const REQUIRED = ['bucket']
const OPTIONAL = [
  'accessKeyId',
  'secretAccessKey',
  'region',
  'endpoint',
  'sessionToken',
  'forcePathStyle',
]

// What `kick env example` writes above each variable.
const DESCRIPTIONS: Record<string, string> = {
  bucket: 'Bucket name',
  accessKeyId:
    'Access key; set with S3_SECRET_ACCESS_KEY, or neither and pass credentials to s3FromSettings() (an IAM role)',
  secretAccessKey: 'Secret for S3_ACCESS_KEY_ID',
  region: 'Region, e.g. eu-west-1 (auto for Cloudflare R2); default us-east-1',
  endpoint: 'Endpoint of an S3-compatible service (Cloudflare R2, MinIO); unset for AWS',
  sessionToken: 'Session token for temporary credentials',
  forcePathStyle:
    '<endpoint>/<bucket>/<key> addressing; default true with S3_ENDPOINT, false for AWS',
}

/** String fields, written out so the app can use any schema library or none. Empty is unset. */
const schema: KickSchema<S3Fields> = {
  safeParse(data) {
    const input = (data ?? {}) as Record<string, unknown>
    const out: Record<string, string | boolean> = {}
    const issues: SchemaIssue[] = []
    for (const key of [...REQUIRED, ...OPTIONAL]) {
      const raw = input[key]
      if (raw === undefined || raw === '') {
        if (REQUIRED.includes(key))
          issues.push({ path: [key], message: 'Required', code: 'required' })
      } else if (key === 'forcePathStyle') {
        // `true` / `false` from env, or a boolean from `provide()`.
        if (typeof raw === 'boolean') out[key] = raw
        else if (raw === 'true' || raw === 'false') out[key] = raw === 'true'
        else issues.push({ path: [key], message: 'Expected true or false', code: 'type' })
      } else if (typeof raw !== 'string') {
        issues.push({ path: [key], message: 'Expected a string', code: 'type' })
      } else if (key === 'endpoint' && !URL.canParse(raw)) {
        issues.push({ path: [key], message: 'Expected a URL', code: 'format' })
      } else {
        out[key] = raw
      }
    }
    if (!out.accessKeyId !== !out.secretAccessKey) {
      const unset = out.accessKeyId ? 'secretAccessKey' : 'accessKeyId'
      issues.push({ path: [unset], message: 'Required with the other key', code: 'required' })
    }
    return issues.length > 0 ? { success: false, issues } : { success: true, data: out as S3Fields }
  },
  toJsonSchema: () => ({
    type: 'object',
    properties: Object.fromEntries(
      [...REQUIRED, ...OPTIONAL].map((key) => [
        key,
        {
          type: key === 'forcePathStyle' ? 'boolean' : 'string',
          description: DESCRIPTIONS[key],
        },
      ]),
    ),
    required: REQUIRED,
  }),
}

/**
 * `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
 * `S3_SESSION_TOKEN`, `S3_FORCE_PATH_STYLE`. Leave both keys unset on a host
 * with an IAM role and pass `credentials` to {@link s3FromSettings}.
 */
export const S3Settings = defineSettings('S3', schema)

/**
 * An {@link s3Storage} configured from {@link S3Settings} — or another
 * instance, `S3Settings.scoped('R2')`. Built on first use, after the app has
 * bound its settings, and rebuilt when the bound value changes (an HMR
 * rebuild). `options` adds what env can't carry, like `fetch`; a variable
 * that is set wins over it.
 */
export function s3FromSettings(
  section: Settings<SettingsOf<typeof S3Settings>> = S3Settings,
  options: Partial<S3StorageOptions> = {},
): S3Storage {
  let storage: S3Storage | undefined
  let built: S3Fields | undefined
  const real = () => {
    const settings = section.get()
    if (!storage || settings !== built) {
      built = settings
      // Keys set in env win over a `credentials` option, like every other variable.
      const { credentials, ...rest } = options
      storage = s3Storage({
        ...rest,
        ...(settings.accessKeyId ? {} : { credentials }),
        ...settings,
      })
    }
    return storage
  }
  const wrapper: S3Storage = {
    put: (...args) => real().put(...args),
    putIfAbsent: (...args) => real().putIfAbsent(...args),
    get: (...args) => real().get(...args),
    getStream: (...args) => real().getStream(...args),
    stat: (...args) => real().stat(...args),
    exists: (...args) => real().exists(...args),
    delete: (...args) => real().delete(...args),
    list: (...args) => real().list(...args),
    url: (...args) => real().url(...args),
    uploadUrl: (...args) => real().uploadUrl(...args),
    uploadForm: (...args) => real().uploadForm(...args),
    compose: (...args) => real().compose(...args),
    get location() {
      return real().location
    },
    multipart: {
      create: (...args) => real().multipart.create(...args),
      partUrl: (...args) => real().multipart.partUrl(...args),
      listParts: (...args) => real().multipart.listParts(...args),
      complete: (...args) => real().multipart.complete(...args),
      abort: (...args) => real().multipart.abort(...args),
    },
  }
  // For StorageAdapter: the section to declare, so the app validates it at startup.
  return Object.assign(wrapper, { [Symbol.for('kickjs-storage.settings')]: section })
}
