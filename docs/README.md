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

The canonical site is **[kickjs.app](https://kickjs.app/)**, served from the domain root.

### Vercel / Netlify

**Netlify** — the repo-root `netlify.toml` is authoritative (`base = "docs"`, `command = "pnpm build"`, `publish = ".vitepress/dist"`). Leave **Base directory**, **Build command** and **Publish directory** blank in the Netlify UI so they don't override the file.

**Vercel** — set the project's **root directory to `docs`**; `docs/vercel.json` supplies the build command and output dir.

Both run through `pnpm` so the workspace-local `vitepress` bin resolves (a bare `vitepress` isn't on `PATH`). The config defaults (`base "/"`, hostname `https://kickjs.app/`) already match this deploy — **no env vars required**.

### Deploying under a subpath

For a host that serves under a path prefix (e.g. GitHub Pages at `/kick-js/`), override **both**:

| Var             | Value for the subpath host           |
| --------------- | ------------------------------------ |
| `DOCS_BASE`     | `/kick-js/`                          |
| `DOCS_HOSTNAME` | `https://forinda.github.io/kick-js/` |

The build **fails** if `DOCS_BASE` is overridden while `DOCS_HOSTNAME` is left at the `kickjs.app` default — otherwise the sitemap/OG tags would silently point at the wrong site.
