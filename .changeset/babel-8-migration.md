---
'@forinda/kickjs-vite': major
---

Upgrade to Babel 8 (`@babel/core` 7 → 8).

**Breaking: raises the Node floor to `^22.18.0 || >=24.11.0`.** Babel 8 is ESM-only and sets that engine requirement; the plugin inherits it. Node 20 reached end-of-life in 2026, so the practical impact is limited — but it is a breaking change for anyone still on it, hence the major.

Two changes were needed in `babel-strip-devtools.ts`, both consequences of Babel 8 shipping as native ESM with first-party types:

- `import babel from '@babel/core'` → `import * as babel from '@babel/core'`. Babel 8 exposes only named exports; the default import fails at load with `SyntaxError: The requested module '@babel/core' does not provide an export named 'default'`. This affected the published `dist/index.mjs`, not just the source.
- `babel.PluginObj` → `babel.PluginObject`, the spelling in Babel's own type declarations.

`@types/babel__core` is dropped — Babel 8 ships its own types.

No behavior change to the devtools strip itself. `transformSync`, the `typescript` / `decorators-legacy` / `classProperties` parser plugins, `generatorOpts.retainLines`, and the `babel.types.*` namespace all carry over unchanged, and the full existing test suite passes against Babel 8 untouched.
