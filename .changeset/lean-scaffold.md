---
'@forinda/kickjs-cli': minor
---

`kick new` writes fewer files — 32 instead of 57 for a minimal project — and the rest is one command away:

- **Deploy files on demand.** `kick g deploy netlify | vercel | docker` adds what a target needs: `netlify.toml` / `vercel.json`, `src/serverless.ts` and the `build:netlify` / `build:vercel` script, or a `Dockerfile` and `.dockerignore`. In a fullstack workspace, run it at the root. `kick new --deploy netlify,vercel,docker` writes them up front; without it, a new project has none of them.
- **Agent docs.** A new project gets `.agents/AGENTS.md` and `CLAUDE.md`; `kick g agents` adds the skills and the Gemini and Copilot files.
