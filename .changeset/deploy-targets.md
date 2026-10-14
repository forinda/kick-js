---
'@forinda/kickjs-cli': minor
---

Every project `kick new` creates now deploys to a Node host, Docker, Netlify and Vercel without extra files:

- **Docker:** a `Dockerfile` and `.dockerignore` matched to the template (API, Inertia, fullstack) and the package manager (pnpm, npm, yarn, bun). The image runs `node dist/index.js` as a non-root user, and `.env` files stay out of it.
- **`packageManager`:** `package.json` records the package manager the project was created with, so corepack uses the same version in CI and in the image.
- **Serverless entry:** `src/serverless.ts` ships with every template as `createHandler(() => import('./index'))`, so `build:netlify` / `build:vercel` work on a fresh project.
- **Inertia on Netlify and Vercel:**
  - The platform serves `dist/client`.
  - The function renders every other path, and carries the asset manifest and SSR bundle.
  - The SSR bundle is self-contained.
  - The template keeps its session in a cookie.
- **`deploy.include`:** lists files the app reads at runtime. They are packaged with the function.
- **Fix: optional peers that aren't installed** (such as `@valibot/to-json-schema`) no longer crash the function bundle at startup. Any bare import the bundler can't reach is now left external.
- **Fix: build bookkeeping** (`.vite/`) in a published static directory is no longer public: Vercel leaves it out, and Netlify answers 404.
