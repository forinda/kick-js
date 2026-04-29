// Ambient declaration for the build-time DevTools flag injected by
// `devtoolsFlagPlugin()` (default: `__KICKJS_DEVTOOLS__`).
//
// Adopters add a triple-slash directive in their entry file or
// reference this package from their tsconfig "types" so the global
// resolves at type-check time:
//
//   /// <reference types="@forinda/kickjs-vite/globals" />
//
//   if (__KICKJS_DEVTOOLS__) {
//     const { DevToolsAdapter } = await import('@forinda/kickjs-devtools')
//     adapters.push(DevToolsAdapter())
//   }
//
// The bundler substitutes `__KICKJS_DEVTOOLS__` with `true` / `false`
// at build time; Vite/Rollup tree-shakes the unreachable branch +
// the dynamic `import()` chunk along with it.

declare global {
  /**
   * Build-time flag — `true` during `vite dev` and tests, `false`
   * during `vite build` (production). Override per-build via
   * `devtoolsFlagPlugin({ enabled })` or the `KICKJS_DEVTOOLS` env
   * var.
   */
  const __KICKJS_DEVTOOLS__: boolean
}

export {}
