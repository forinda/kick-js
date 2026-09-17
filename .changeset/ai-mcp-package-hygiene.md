---
'@forinda/kickjs-mcp': minor
'@forinda/kickjs-ai': patch
---

Package hygiene for the AI and MCP packages.

- **MCP default transport is now `'http'`** (Streamable HTTP), matching the docs. It was `'sse'`, which behaved the same but logged a deprecation warning on every boot; `'sse'` is still accepted as a deprecated alias.
- `@forinda/kickjs` peer range is `>=8.5.0 <9.0.0` for both packages (it had no upper bound; the new features need the 8.6.0 released alongside). The MCP SDK peer is `^1.30.0`, the version the adapter is built and tested against (was `^1.0.0`).
- `reflect-metadata` is no longer a dependency of either package; neither imports it.
- `@forinda/kickjs-ai` no longer lists providers it doesn't ship (Gemini) in its keywords or docs.
