# Options

| option                                             | default                                                                    |                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `viewsDir`                                         | `'src/views'`                                                              |                                                                                                                                            |
| `roots`                                            | none                                                                       | named view roots, `{ billing: '/abs/path' }` — absolute folders; the Vite plugin fills them in from kick.config ([view roots](./roots.md)) |
| `componentsDir`                                    | `'components'`                                                             | inside `viewsDir`                                                                                                                          |
| `pipesFile`                                        | `'src/views/pipes.ts'`                                                     | `.js` also works; without Vite, Node runs a `.ts` file only when it can strip types (22.18+)                                               |
| `validatorsFile`                                   | `'<viewsDir>/validators.ts'`                                               | [your own validators](./forms.md#your-own-validators); read when there is no build                                                         |
| `layout`                                           | none                                                                       | a layout name, or folder prefix → layout                                                                                                   |
| `baseLayout`                                       | none                                                                       | the shell around every page's outermost layout                                                                                             |
| `locale`                                           | `'en-US'`                                                                  |                                                                                                                                            |
| `timeZone`                                         | `'UTC'`                                                                    |                                                                                                                                            |
| `strict`                                           | `false`                                                                    | unknown names and values that can't print become errors                                                                                    |
| `share`                                            | none                                                                       | `(ctx) => data`                                                                                                                            |
| `assets`                                           | none                                                                       | `(entry, data) => tags`, for `@assets`                                                                                                     |
| `cache`                                            | `true`                                                                     | `false` re-reads every template on every render                                                                                            |
| `dev`                                              | `NODE_ENV === 'development'`, or no `bundle` (`kick dev`), with `KickView` | re-check changed templates on each render                                                                                                  |
| `bundle`, `pipes`, `clientScriptPath`, `clientDir` | from `virtual:kick-views`                                                  | pass them all with `...kickViews`; without `clientDir`, files the build wrote to disk aren't served                                        |
| `loader`                                           | the file loader                                                            | `{ list, read, version? }` for templates from anywhere else                                                                                |

The Vite plugin's own options, in `vite.config.ts` as `kickjs({ views: { … } })`:

| option             | default                      |                                                                                             |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `viewsDir`         | `'src/views'`                |                                                                                             |
| `componentsDir`    | `'components'`               |                                                                                             |
| `pipesFile`        | `'<viewsDir>/pipes.ts'`      |                                                                                             |
| `validatorsFile`   | `'<viewsDir>/validators.ts'` | [your own validators](./forms.md#your-own-validators)                                       |
| `clientScriptPath` | `'/_kick/c'`                 | the URL path client files are served under                                                  |
| `clientFiles`      | `'disk'`                     | `'bundle'` keeps client files in the server bundle                                          |
| `publicDir`        | `'public'`                   | relative to the build's `outDir`, or absolute; files go to `<publicDir><clientScriptPath>/` |
| `inlineLimit`      | `4096`                       | images and fonts up to this many bytes are inlined (`'disk'` only)                          |
