/**
 * Dockerfile + .dockerignore for a scaffolded project — one image that runs
 * the long-running server (`node dist/index.js`), for any host that runs
 * containers.
 *
 * Three stages: production dependencies, the build, and a slim runtime that
 * copies both. The runtime has no package manager and no dev dependencies —
 * the `kick` CLI included, which is why it starts `node` directly rather than
 * `kick start`.
 */
import { specVersion } from './project-config'

export type DockerProjectKind = 'api' | 'inertia' | 'fullstack'
export type DockerPackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

interface PmCommands {
  lockfile: string
  /** Extra files the install reads, beside package.json and the lockfile. */
  installFiles: string[]
  install: string
  installProd: string
  run: (script: string) => string
  /** Image the install and build run in. */
  image: string
  setup?: string
}

const NODE_IMAGE = 'node:22-slim'

const PM: Record<DockerPackageManager, PmCommands> = {
  pnpm: {
    lockfile: 'pnpm-lock.yaml',
    // allowBuilds (which install scripts may run) lives here.
    installFiles: ['pnpm-workspace.yaml'],
    install: 'pnpm install --frozen-lockfile',
    installProd: 'pnpm install --prod --frozen-lockfile',
    run: (script) => `pnpm run ${script}`,
    image: NODE_IMAGE,
    setup: 'RUN corepack enable',
  },
  npm: {
    lockfile: 'package-lock.json',
    installFiles: [],
    install: 'npm ci',
    installProd: 'npm ci --omit=dev',
    run: (script) => `npm run ${script}`,
    image: NODE_IMAGE,
  },
  yarn: {
    lockfile: 'yarn.lock',
    installFiles: [],
    install: 'yarn install --frozen-lockfile',
    installProd: 'yarn install --production --frozen-lockfile',
    run: (script) => `yarn run ${script}`,
    image: NODE_IMAGE,
    setup: 'RUN corepack enable',
  },
  bun: {
    lockfile: 'bun.lock',
    installFiles: [],
    install: 'bun install --frozen-lockfile',
    installProd: 'bun install --production --frozen-lockfile',
    run: (script) => `bun run ${script}`,
    image: 'oven/bun:1',
  },
}

const YARN_BERRY: PmCommands = {
  lockfile: 'yarn.lock',
  installFiles: ['.yarnrc.yml'],
  install: 'yarn install --immutable',
  installProd: 'yarn workspaces focus --all --production',
  run: (script) => `yarn run ${script}`,
  image: NODE_IMAGE,
  setup: 'RUN corepack enable',
}

const RUN_HINT: Record<DockerProjectKind, string> = {
  api: 'docker run -p 3000:3000 <name>',
  inertia: 'docker run -p 3000:3000 -e SESSION_SECRET=<a long random string> <name>',
  fullstack: 'docker run -p 3000:3000 <name>',
}

/**
 * `spec` is the project's `packageManager` (`yarn@4.1.0`): Yarn 2+ installs
 * differently from Yarn 1, and Bun before 1.2 writes `bun.lockb`.
 */
export function generateDockerfile(
  kind: DockerProjectKind,
  pm: DockerPackageManager,
  name: string,
  spec?: string,
): string {
  const [major = 0, minor = 0] = specVersion(spec) ?? []
  const p =
    pm === 'yarn' && major >= 2
      ? YARN_BERRY
      : pm === 'bun' && spec && (major < 1 || (major === 1 && minor < 2))
        ? { ...PM.bun, lockfile: 'bun.lockb' }
        : PM[pm]
  const setup = p.setup ? `\n${p.setup}` : ''
  const manifests =
    kind === 'fullstack'
      ? // A workspace installs from every member's manifest.
        ['package.json', p.lockfile, ...p.installFiles, 'server/package.json', 'web/package.json']
      : ['package.json', p.lockfile, ...p.installFiles]
  // Each COPY names its destination, so members keep their directories.
  const copyManifests = manifests
    .map(
      (file) =>
        `COPY ${file} ./${file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''}`,
    )
    .join('\n')

  const header = `# syntax=docker/dockerfile:1
# ${name} — the long-running server in one image.
#
#   docker build -t ${name} .
#   ${RUN_HINT[kind].replace('<name>', name)}
#
# Environment comes from the platform or \`docker run\`; .env files are not
# copied into the image. The lockfile must be committed — installs are frozen.
`

  if (kind === 'fullstack') {
    return `${header}
FROM ${p.image} AS base
WORKDIR /app${setup}

# Production dependencies of every workspace member.
FROM base AS deps
${copyManifests}
RUN ${p.installProd}
# Hoisting may leave a member without its own node_modules; the runtime copies both.
RUN mkdir -p node_modules server/node_modules

# The server bundle and the built web app.
FROM base AS build
${copyManifests}
RUN ${p.install}
COPY . .
RUN ${p.run('build')}

FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
# SpaAdapter serves ../web/dist relative to the server.
COPY --from=build /app/web/dist ./web/dist
WORKDIR /app/server
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
`
  }

  const what =
    kind === 'inertia'
      ? '# The server, the pages (dist/client) and the SSR bundle (dist/ssr).'
      : '# The server bundle.'
  return `${header}
FROM ${p.image} AS base
WORKDIR /app${setup}

FROM base AS deps
${copyManifests}
RUN ${p.installProd}

${what}
FROM base AS build
${copyManifests}
RUN ${p.install}
COPY . .
RUN ${p.run('build')}

FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
`
}

export function generateDockerignore(): string {
  const lines = [
    '# Rebuilt inside the image.',
    '**/node_modules',
    '**/dist',
    '**/.kickjs',
    '# Secrets stay out of the image; pass them at run time.',
    '**/.env',
    '**/.env.*',
    '!**/.env.example',
    '# Platform and tooling output.',
    '.netlify',
    '.vercel',
    '.git',
    '**/coverage',
    '*.log',
  ]
  return `${lines.join('\n')}\n`
}
