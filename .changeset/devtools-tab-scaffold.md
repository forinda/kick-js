---
'@forinda/kickjs-cli': patch
'@forinda/kickjs-devtools': patch
---

Custom DevTools tabs.

- **`kick g adapter` / `kick g plugin`:** both now write the `introspect()` and `devtoolsTabs()` hooks (commented out), in shapes that type-check once uncommented. Before, the adapter's tab example used fields the descriptor doesn't have (`kind`, `render`), its snapshot was missing `name` and `kind`, and neither example said where `defineDevtoolsTab` or `IntrospectionSnapshot` come from. The comments now name the import and the `@forinda/kickjs-devtools-kit` dependency to add.
- **Iframe tabs:** the dashboard token is only added to an iframe `src` on the app's own origin. It was appended to every `src`, so a tab pointing at another site received the token.
