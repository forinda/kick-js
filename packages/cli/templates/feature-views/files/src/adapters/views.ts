import { KickView } from '@forinda/kickjs-view'
import { views } from '../views'

/** Server-rendered pages: `await ctx.render('home', data)` in a controller. */
export const viewsAdapter = () => KickView({ views })
