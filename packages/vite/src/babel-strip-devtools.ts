/**
 * Babel-based devtools stripper for production builds.
 *
 * Built around a single rule: anything sourced from
 * `@forinda/kickjs-devtools-kit` (or any of its sub-paths) is dev-
 * only and must not ship in the prod bundle. The transform walks
 * each module and removes:
 *
 *  1. `import ... from '@forinda/kickjs-devtools-kit'` declarations
 *     (named, default, namespace, side-effect — all forms).
 *  2. Top-level `ExpressionStatement`s whose call/expression root is
 *     a binding imported from devtools-kit
 *     (e.g., `defineDevtoolsRenderTab({...})`).
 *  3. Side-effect imports whose path ends in `/devtools-events`
 *     (with any extension) — type-augmentation modules shipped by
 *     adapter packages. Already side-effect-only, safe to drop in
 *     prod.
 *
 * The transform is intentionally conservative. It will not:
 *
 *  - Remove identifier *references* outside of the rules above. If
 *    your code calls `defineDevtoolsRenderTab(...)` inside a regular
 *    function body (i.e. not a top-level `ExpressionStatement`),
 *    the reference stays. After we drop the import the build will
 *    fail loud — that is the signal to gate the call behind
 *    `__KICKJS_DEVTOOLS__` (see `devtools-flag-plugin.ts`).
 *  - Touch files that don't import from devtools-kit at all.
 *  - Touch files in `node_modules` (Vite's plugin chain handles
 *    that already, but the transform short-circuits on a quick
 *    string check too).
 *
 * The dev path is unchanged: this transform only runs when Vite's
 * `command === 'build'`. In dev, devtools-kit imports stay live.
 *
 * Spec: docs/db/m3-plan.md §M3.C.
 */

import babel from '@babel/core'

const DEVTOOLS_KIT_RE = /^@forinda\/kickjs-devtools-kit(\/.*)?$/
const DEVTOOLS_EVENTS_RE = /(^|\/)devtools-events(\.[a-z]+)?$/

export interface StripDevtoolsOptions {
  /**
   * When `false`, skips files that don't import devtools-kit. The
   * default short-circuit is a substring check on the source text;
   * disable it only for tests where you want the visitor to run
   * unconditionally.
   *
   * @default true
   */
  fastReject?: boolean
}

export interface StripResult {
  /** Transformed source. Returns the original `code` when nothing was stripped. */
  code: string
  /** `true` if the visitor removed at least one node. */
  changed: boolean
}

/**
 * Strip devtools-kit imports and their dependent top-level calls
 * from a single TypeScript module. Pure — no I/O, no Vite, no
 * filesystem.
 */
export function stripDevtoolsCode(
  source: string,
  filename: string,
  opts: StripDevtoolsOptions = {},
): StripResult {
  if (opts.fastReject !== false) {
    if (!source.includes('@forinda/kickjs-devtools-kit') && !source.includes('devtools-events')) {
      return { code: source, changed: false }
    }
  }

  let changed = false

  // Add the `jsx` plugin only for files that may contain JSX —
  // `.tsx` / `.jsx`. Mixing `jsx` + `typescript` on a `.ts` file
  // breaks the angle-bracket type-assertion syntax (`<T>x`); kept
  // off by default. `.tsx` files would otherwise fail to parse on
  // any embedded JSX.
  const isJsx = /\.(?:tsx|jsx)$/i.test(filename)
  const parserPlugins: string[] = ['typescript', 'decorators-legacy', 'classProperties']
  if (isJsx) parserPlugins.push('jsx')

  const result = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    parserOpts: {
      plugins: parserPlugins as never,
    },
    generatorOpts: {
      retainLines: true,
    },
    plugins: [
      function devtoolsStripPlugin(): babel.PluginObj {
        return {
          name: 'kickjs-strip-devtools',
          visitor: {
            Program(path) {
              const devtoolsBindings = new Set<string>()

              // Pass 1 — drop devtools-kit imports + collect bound names.
              for (const stmt of path.get('body')) {
                if (!stmt.isImportDeclaration()) continue
                const src = stmt.node.source.value
                if (!DEVTOOLS_KIT_RE.test(src) && !DEVTOOLS_EVENTS_RE.test(src)) continue

                for (const spec of stmt.node.specifiers) {
                  if (spec.local?.name) devtoolsBindings.add(spec.local.name)
                }
                stmt.remove()
                changed = true
              }

              if (devtoolsBindings.size === 0) return

              // Pass 2 — drop top-level expression statements rooted
              // in a stripped binding.
              for (const stmt of path.get('body')) {
                if (!stmt.isExpressionStatement()) continue
                const root = rootIdentifier(stmt.node.expression)
                if (root && devtoolsBindings.has(root)) {
                  stmt.remove()
                  changed = true
                }
              }
            },
          },
        }
      },
    ],
  })

  // Return the original source verbatim when nothing was stripped —
  // Babel's generator otherwise normalises whitespace + adds
  // semicolons, which would invalidate Vite's cache for files that
  // shouldn't have changed at all.
  if (!result || result.code == null || !changed) {
    return { code: source, changed: false }
  }
  return { code: result.code, changed: true }
}

/**
 * Walk a call/member expression tree to its root identifier. Returns
 * `null` for expressions we don't recognize (literals, sequence
 * expressions, etc.) — the caller skips those rather than guessing.
 */
function rootIdentifier(expr: babel.types.Expression): string | null {
  let node: babel.types.Node = expr
  while (true) {
    if (node.type === 'Identifier') return node.name
    if (node.type === 'CallExpression') {
      node = node.callee
      continue
    }
    if (node.type === 'MemberExpression') {
      node = node.object
      continue
    }
    if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') {
      node = node.expression
      continue
    }
    return null
  }
}
