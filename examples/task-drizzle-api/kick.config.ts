import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',
  modulesDir: 'src/modules',
  defaultRepo: 'drizzle',

  // Asset Manager (assets-plan.md). Mail templates live next to the
  // code in dev (`src/templates/mails/*.ejs`); `kick build` copies
  // them to `dist/mails/` + emits a manifest so the runtime resolver
  // returns the right path in either mode without dev/prod branching
  // at the call site.
  //
  // Usage in code:
  //   import { assets } from '@forinda/kickjs'
  //   const path = assets.mails.welcome()
  //   const html = await ejs.renderFile(path, { user })
  assetMap: {
    mails: { src: 'src/templates/mails', glob: '**/*.ejs' },
  },
})
