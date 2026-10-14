// Entry for Netlify and Vercel — `kick build:netlify` / `kick build:vercel`
// bundle this file. It serves the app src/index.ts describes, from the same
// bootstrap() options, without listening on a port.
import { createHandler } from '@forinda/kickjs'

export const handler = createHandler(() => import('./index'))
