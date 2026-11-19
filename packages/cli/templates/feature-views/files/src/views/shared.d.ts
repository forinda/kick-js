// Names createViews({ share }) in src/views.ts gives every page. List them
// here so `kick typegen` doesn't make controllers pass them to ctx.render.
// See https://kickjs.app/guide/views#typed-render-data
declare module '@forinda/kickjs' {
  interface KickViewShared {
    // user: { name: string } | undefined
  }
}

export {}
