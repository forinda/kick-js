import { StorageAdapter } from '@forinda/kickjs-storage/adapter'
import { diskStorage } from '@forinda/kickjs-storage/disk'
import { S3Settings, s3FromSettings } from '@forinda/kickjs-storage/settings'

export { STORAGE } from '@forinda/kickjs-storage/adapter'
export type { Storage } from '@forinda/kickjs-storage'

/**
 * Where the app keeps files: the uploads/ folder until S3_BUCKET is set, then
 * that bucket (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION; S3_ENDPOINT
 * for Cloudflare R2 or MinIO). Inject it with `@Autowired(STORAGE)`. The bucket's
 * section is declared optional, so `kick env example` lists S3_* while files are
 * on disk; with S3_BUCKET set, a missing or invalid variable stops startup.
 */
export const storageAdapter = () =>
  StorageAdapter({
    storage: process.env.S3_BUCKET ? s3FromSettings() : diskStorage({ root: 'uploads' }),
    settings: [S3Settings.optional()],
  })
