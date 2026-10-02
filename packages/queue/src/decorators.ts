/**
 * `@Job` / `@Process` live in `@forinda/kickjs`, where any job runner can
 * read them (`listJobHandlers`, `runJob`). Re-exported here so existing
 * imports from `@forinda/kickjs-queue` keep working.
 */
export { Job, Process } from '@forinda/kickjs'
