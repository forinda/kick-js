import { createClient } from '@forinda/kickjs-client'

// KickClientApi is ambient — the resolved route map from
// server/.kickjs/types/kick__client.d.ts, wired in tsconfig's `types`. Every
// response type is a literal shape, so nothing from the server's source graph
// enters this program.
//
// Keys are module-mount-relative paths; the bootstrap-level '/api/v1' prefix
// lives here in baseUrl, and the Vite dev proxy forwards it to the KickJS
// server.
//
// Prefer an explicit import? The same file exports the type:
//   import type { Api } from '../../server/.kickjs/types/kick__client'
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
