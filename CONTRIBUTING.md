# Contributing to KickJS

Thanks for helping make KickJS better. Bug reports, fixes, docs and features are
all welcome, from anyone. This guide covers setting up the repo, the checks a
change needs, and how a pull request lands.

- [Code of conduct](#code-of-conduct)
- [Setup](#setup)
- [The repository](#the-repository)
- [Making a change](#making-a-change)
- [Checks](#checks)
- [Code style](#code-style)
- [Tests](#tests)
- [Docs](#docs)
- [Pull requests](#pull-requests)
- [Releases](#releases)
- [Issues and questions](#issues-and-questions)

## Code of conduct

Be welcoming and respectful: assume good faith, take criticism of your code
gracefully, and keep discussion about the work. Harassment, insults, sexualized
language or imagery, and publishing someone's private information are not
tolerated. Report conduct problems to the maintainers by
[opening an issue](https://github.com/forinda/kick-js/issues), or privately
through a maintainer's GitHub profile.

## Setup

You need **Node.js 20 or newer** (CI runs 24), **pnpm**, and Git.

```bash
git clone https://github.com/<your-username>/kick-js.git
cd kick-js
git remote add upstream https://github.com/forinda/kick-js.git
pnpm install
pnpm build
pnpm test
```

`pnpm install` also installs the git hooks (lefthook): every commit runs the
formatter check, oxlint and the token lint on the staged files. Builds and the
full test suite run in CI, not on commit.

## The repository

A pnpm + Turbo monorepo. Every package under `packages/` publishes as
`@forinda/kickjs-*`, except the private ones.

```
packages/
  kickjs/     the framework: DI wiring, HTTP layer, RequestContext, runtimes
              (Express / Fastify / h3), the web entry (@forinda/kickjs/web)
  cli/        kick new, generators, typegen, kick add / doctor
  di/ schema/ client/ vite/ swagger/ testing/ devtools/ db/ …
  <pkg>/__tests__/   that package's tests
__tests__/    root integration tests
docs/         the VitePress site (kickjs.app)
scripts/      the scaffold matrix, benchmarks, bundle-size and Bun smoke checks
```

Runnable example apps live in
[forinda/kickjs-examples-archive](https://github.com/forinda/kickjs-examples-archive),
not here. Create them with the CLI (`kick new`, `kick g module`) — a scaffold
that fails is a CLI bug to fix first.

[`.agents/AGENTS.md`](./.agents/AGENTS.md) goes deeper: where things live, how
to add a middleware, a package or an adapter, and the conventions the codebase
follows. It's written for AI coding agents and reads fine for people too.

## Making a change

1. Branch from an up-to-date `main`:

   ```bash
   git checkout main && git pull upstream main
   git checkout -b fix/route-prefix
   ```

   Name the branch by kind: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`,
   `ci/`, `test/`.

2. Make the change, with tests, and docs if users see it.
3. Run the [checks](#checks) for what you touched.
4. Add a changeset unless the change is docs, tests or CI only:

   ```bash
   pnpm changeset
   ```

   Pick each affected package and its bump, then describe the change the way a
   user reads it in the changelog — what they can do now, not how it's built.

5. Commit with a [Conventional Commits](https://www.conventionalcommits.org/)
   message, push, and open a pull request against `main`.

## Checks

| You changed                                 | Run                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| Anything                                    | `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` |
| The CLI, a scaffold template or a generator | `pnpm build && pnpm scaffold:matrix <scenario>`                               |
| A runtime, the web entry or the bundle      | `pnpm test:bundle-size`, `pnpm test:bun` (needs Bun)                          |
| Token names (DI tokens, context keys)       | `pnpm lint:tokens`                                                            |
| `packages/devtools`                         | `pnpm --filter @forinda/kickjs-devtools build:spa`, then `pnpm build`         |
| Docs                                        | `pnpm docs:build` (fails on a dead link)                                      |

`pnpm format` fixes formatting; `pnpm lint:fix` fixes what oxlint can. Turbo
caches builds and tests — `pnpm build:nocache` rebuilds everything.

### The scaffold matrix

`pnpm scaffold:matrix` checks what users actually get from `kick new`. For each
scenario it scaffolds a project, installs it against this checkout's packages
(packed with `pnpm pack`, as npm would ship them), runs `kick typegen` and
`tsc`, builds it, starts it and requests its routes. Some scenarios also build
for Netlify and Vercel, or build and run the Dockerfile.

```bash
pnpm build                                     # the matrix packs the built packages
pnpm scaffold:matrix                           # every scenario
pnpm scaffold:matrix yes-default inertia       # just these
node scripts/scaffold-matrix.mjs --list        # the scenarios
```

Run it for any change to `packages/cli` — templates, generators, `kick add` —
and for changes to a package a scaffold depends on in a way its unit tests
don't show. Third-party packages come from the registry, so it needs a
network connection; a full run takes a few minutes per scenario.

In CI, pull requests that touch the CLI run the `yes-default` scenario, and
every scenario runs daily.

## Code style

- **oxfmt** formats: no semicolons, single quotes, trailing commas, 100
  columns. Not Prettier — it reformats unrelated lines.
- **oxlint** lints, plus `pnpm lint:tokens` for the token naming conventions.
- TypeScript is strict. Avoid `any` in public types; a cast at an internal
  seam is fine with a comment saying why.
- Comments say why, not what. Keep them true when the code changes.
- Runtime code stays engine-neutral: write against `ctx` and the `ctx.http`
  adapter surface, not Express's request and response, unless the file is the
  Express runtime itself.

## Tests

Tests use **Vitest**: per package in `packages/<pkg>/__tests__/`, and the root
`__tests__/` for integration tests across packages.

- A bug fix comes with a test that fails without it.
- A behaviour that differs by engine runs on all three — see the
  `describe.each` over `expressRuntime()`, `fastifyRuntime()` and `h3Runtime()`
  in existing tests.
- Decorators register when a class is defined, so reset DI between tests:
  `Container.reset()` in `beforeEach`.
- `@forinda/kickjs-testing` has `createTestApp()` and `createTestModule()` for
  booting an app in a test.

Check Vitest's summary for a separate `Errors` line and the exit code, not only
the `Tests` count: an unhandled error can fail a run whose tests all pass.

## Docs

The site lives in `docs/` and builds with `pnpm docs:build`; `pnpm docs:dev`
serves it locally.

- Change the docs in the same pull request as the behaviour.
- Link between pages with relative links (`./middleware.md`), never absolute
  site URLs — they break versioned and translated builds.
- Write for the reader: what they can do and how, not how the code works.

Design notes and plans stay out of the repository (in the git-ignored
`.ignored/`), and nothing tracked — code comments, docs, changesets, pull
requests — refers to them.

## Pull requests

The [pull request template](./.github/pull_request_template.md) carries the
checklist. Keep a pull request to one change; a stack of small dependent pull
requests reviews faster than one large one.

CI runs formatting, oxlint, the token lint, typecheck, the tests, the build,
Bun and Deno smoke tests and the bundle-size check, and the scaffold matrix's
smoke scenario when the CLI changed. A maintainer reviews and merges.

Commit messages have no `Co-Authored-By` trailer naming an AI assistant. A
pull request description may say it was written with one.

## Releases

Releases are automated with [Changesets](https://github.com/changesets/changesets)
and npm trusted publishing — you don't bump versions or edit changelogs by
hand. Merging a pull request with a changeset into `main` updates a "Version
Packages" pull request; merging that one publishes. Each package versions on
its own, so `@forinda/kickjs@10.5.0` pairs with `@forinda/kickjs-cli@8.12.1`.
[RELEASE.md](./RELEASE.md) covers pre-release channels and the publishing setup.

## Issues and questions

- **Bugs, features, docs:** [open an issue](https://github.com/forinda/kick-js/issues/new/choose)
  from a template. A minimal reproduction gets a bug fixed fastest.
- **Questions and ideas:** [GitHub Discussions](https://github.com/forinda/kick-js/discussions).
- **Security vulnerabilities:** [report them privately](https://github.com/forinda/kick-js/security/advisories/new),
  not in an issue.
- Issues labelled `good first issue` are a good place to start.
