// Names createViews({ share }) in src/views.ts gives every page. List them
// here so `kick typegen` doesn't make controllers pass them to ctx.render
// (and views.render, for emails). A .ts file, so a mistake here is reported.
// See https://kickjs.app/guide/views#typed-render-data
declare module '@forinda/kickjs' {
  interface KickViewShared {
    // user: { name: string } | undefined
  }
}
declare module '@forinda/kickjs-view' {
  interface KickViewShared {
    // user: { name: string } | undefined
  }
}

// Makes this file a module, so the blocks above add to the interfaces
// instead of replacing the packages' own declarations.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {}
