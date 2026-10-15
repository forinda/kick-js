# @forinda/kickjs-storage

File storage for KickJS — one `Storage` interface over memory, local disk, and S3-compatible buckets (AWS S3, Cloudflare R2, MinIO), with signed URLs and no AWS SDK.

## Install

```bash
kick add storage
```

## Quick Example

```ts
import { s3Storage } from '@forinda/kickjs-storage' // Node, Bun, Deno, Workers
import { diskStorage } from '@forinda/kickjs-storage/disk' // Node

const files =
  process.env.NODE_ENV === 'production'
    ? s3Storage({
        bucket: 'avatars',
        region: 'eu-west-1',
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      })
    : diskStorage({ root: './uploads', baseUrl: '/uploads' })

await files.put('avatars/42.png', ctx.file!.buffer, { contentType: 'image/png' })
const link = await files.url('avatars/42.png', { expiresIn: 600 }) // presigned on S3
```

From the environment (`S3_BUCKET`, `S3_ACCESS_KEY_ID`, …), validated at startup:

```ts
import { S3Settings, s3FromSettings } from '@forinda/kickjs-storage/settings'

bootstrap({ modules, settings: [S3Settings] })
const files = s3FromSettings()
```

Resumable uploads through your server, for tus-js-client and Uppy:

```ts
import { TusAdapter } from '@forinda/kickjs-storage/tus'

bootstrap({ modules, adapters: [TusAdapter({ path: '/api/uploads', storage: files })] })
```

## Documentation

[kickjs.app/guide/file-storage](https://kickjs.app/guide/file-storage)

## License

MIT
