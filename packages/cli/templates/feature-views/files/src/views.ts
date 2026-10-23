/// <reference types="@forinda/kickjs-view/virtual" />
import kickViews from 'virtual:kick-views'
import { createViews } from '@forinda/kickjs-view'

/**
 * The app's `.kick` templates (src/views). `kick build` checks them and ships
 * them in the build; `kick dev` reads them on each request.
 */
export const views = createViews({ ...kickViews, layout: 'layouts/main' })
