import { defineConfig } from 'vite'
import { readFileSync } from 'fs'
import { builtinModules } from 'module'
import { resolve } from 'path'

const view = JSON.parse(readFileSync(resolve(__dirname, '../view/package.json'), 'utf8'))

export default defineConfig({
  define: { __KICK_VIEW_VERSION__: JSON.stringify(view.version) },
  // Both bundles run in Node: never the packages' `browser` builds.
  resolve: { mainFields: ['module', 'main'], conditions: ['node', 'import', 'require'] },
  build: {
    lib: {
      entry: {
        extension: resolve(__dirname, 'src/extension.ts'),
        // The view language server, bundled so the extension needs no install.
        'kick-view-server': resolve(__dirname, '../view-language-server/src/main.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, name) => `${name}.js`,
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      external: ['vscode', /^node:/, ...builtinModules],
    },
  },
})
