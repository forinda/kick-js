# Translation Guide

KickJS docs support multiple languages via VitePress i18n and a build-time translation script.

## Supported Languages

| Code | Language   | Directory   |
|------|------------|-------------|
| en   | English    | `docs/` (root) |
| fr   | Français   | `docs/fr/`  |
| es   | Español    | `docs/es/`  |
| de   | Deutsch    | `docs/de/`  |
| zh   | 中文        | `docs/zh/`  |
| ja   | 日本語      | `docs/ja/`  |
| pt   | Português  | `docs/pt/`  |
| ar   | العربية     | `docs/ar/`  |

## How It Works

The translation script (`scripts/translate-docs.js`) uses Google Translate to auto-translate all English markdown files into the target languages. It:

1. Scans all `.md` files in `docs/` (excluding `versions/`, `.vitepress/`, and locale dirs)
2. Parses frontmatter YAML and translates text values (title, description, tagline, etc.)
3. Preserves code blocks, links, and markdown structure
4. Skips files that are already up-to-date (based on file modification time)

## Running Translations

### Translate all languages

```bash
pnpm docs:translate
```

### Translate specific language(s)

```bash
pnpm docs:translate zh
pnpm docs:translate fr es
```

### Translate and build

```bash
pnpm docs:translate:build
```

## Notes

- Translations are cached — only modified source files are re-translated
- The script rate-limits API calls to avoid being blocked
- Review auto-translations for accuracy before publishing
- Code blocks, frontmatter keys, and markdown syntax are preserved as-is
- All internal links must use relative paths (e.g., `./getting-started` not `/guide/getting-started`) to work across locales

## Adding a New Language

1. Add the locale to `LOCALES` in `scripts/translate-docs.js`
2. Add the locale config in `docs/.vitepress/config.mts` under `locales`
3. Run `pnpm docs:translate <code>`
4. Verify with `pnpm docs:dev`
