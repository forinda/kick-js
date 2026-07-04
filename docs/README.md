# KickJS Docs

VitePress documentation site for [KickJS](https://github.com/forinda/kick-js). Self-contained workspace package — builds and deploys independently.

## Local development

```bash
pnpm install          # from repo root
pnpm docs:dev         # or, from docs/: pnpm dev
```

Build + preview:

```bash
pnpm docs:build
pnpm docs:preview
```

## Deploy

The site's base path and canonical hostname are env-driven so one config serves every target:

| Var             | Default                              | Set for root-domain hosts |
| --------------- | ------------------------------------ | ------------------------- |
| `DOCS_BASE`     | `/kick-js/`                          | `/`                       |
| `DOCS_HOSTNAME` | `https://forinda.github.io/kick-js/` | your domain               |

### Vercel / Netlify

**Netlify** — the repo-root `netlify.toml` is authoritative (`base = "docs"`, `command = "DOCS_BASE=/ pnpm build"`, `publish = ".vitepress/dist"`). Leave **Base directory**, **Build command** and **Publish directory** blank in the Netlify UI so they don't override the file.

**Vercel** — set the project's **root directory to `docs`**; `docs/vercel.json` supplies the build command and output dir.

Both run the build through `pnpm` so the workspace-local `vitepress` bin resolves (a bare `vitepress` isn't on `PATH`).

**Required:** set `DOCS_HOSTNAME=https://your-domain/` for the sitemap/OG tags. The build **fails** if `DOCS_BASE` is overridden while `DOCS_HOSTNAME` is left at the GitHub Pages default — otherwise those tags would silently point at the wrong site. The committed configs carry a `https://kickjs.example/` placeholder; replace it with the real domain.

### GitHub Pages

Handled by `.github/workflows/deploy-docs.yml` on push to `main`. Uses the defaults (`/kick-js/` project-site paths) — no env overrides.
