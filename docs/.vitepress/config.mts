import { defineConfig } from 'vitepress'
// Docs track the latest release only — older versions are not snapshotted.

const guideSidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is KickJS?', link: '/guide/what-is-kickjs' },
      { text: 'Inspiration', link: '/guide/inspiration' },
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Samples', link: '/guide/samples' },
      { text: 'Migration from Express', link: '/guide/migration-from-express' },
      { text: 'Migrating v3 → v4', link: '/guide/migration-v3-to-v4' },
      { text: 'Project Structure', link: '/guide/project-structure' },
    ],
  },
  {
    text: 'Core Concepts',
    items: [
      { text: 'Decorators', link: '/guide/decorators' },
      { text: 'Dependency Injection', link: '/guide/dependency-injection' },
      { text: 'Modules', link: '/guide/modules' },
      { text: 'Controllers & Routes', link: '/guide/controllers' },
      { text: 'Type Generation', link: '/guide/typegen' },
      { text: 'Middleware', link: '/guide/middleware' },
      { text: 'Context Decorators', link: '/guide/context-decorators' },
      { text: 'Validation', link: '/guide/validation' },
      { text: 'Schema (Zod / Valibot / Yup)', link: '/guide/schema' },
      { text: 'Error Handling', link: '/guide/error-handling' },
      { text: 'Request Lifecycle', link: '/guide/lifecycle' },
    ],
  },
  {
    text: 'Features',
    items: [
      { text: 'Query Parsing', link: '/guide/query-parsing' },
      { text: 'File Uploads', link: '/guide/file-uploads' },
      { text: 'CSRF Protection', link: '/guide/csrf' },
      { text: 'Rate Limiting', link: '/guide/rate-limiting' },
      { text: 'Sessions', link: '/guide/sessions' },
      { text: 'Swagger / OpenAPI', link: '/guide/swagger' },
      { text: 'Configuration', link: '/guide/configuration' },
      { text: 'WebSockets', link: '/guide/websockets' },
      { text: 'Socket.IO', link: '/guide/socketio' },
      { text: 'Server-Sent Events', link: '/guide/sse' },
      { text: 'GraphQL (BYO adapter)', link: '/guide/graphql' },
      { text: 'Reactivity', link: '/guide/reactivity' },
      { text: 'DevTools', link: '/guide/devtools' },
      { text: 'Adapters', link: '/guide/adapters' },
      { text: 'Authentication', link: '/guide/authentication' },
      { text: 'Authorization', link: '/guide/authorization' },
      { text: 'Multi-Tenancy', link: '/guide/multi-tenancy' },
      { text: 'Cron Jobs', link: '/guide/cron' },
      { text: 'Mailer', link: '/guide/mailer' },
      { text: 'Notifications', link: '/guide/notifications' },
      { text: 'OpenTelemetry', link: '/guide/otel' },
      { text: 'AI', link: '/guide/ai' },
      { text: 'MCP (Model Context Protocol)', link: '/guide/mcp' },
      { text: 'Caching', link: '/guide/caching' },
      { text: 'Logging', link: '/guide/logging' },
      { text: 'View Engines', link: '/guide/view-engines' },
      { text: 'Asset Manager', link: '/guide/asset-manager' },
      { text: 'MongoDB', link: '/guide/mongodb' },
      { text: 'SPA Integration', link: '/guide/spa' },
      { text: 'Plugins', link: '/guide/plugins' },
      { text: 'Decorators Reference', link: '/guide/decorators' },
      { text: 'Custom Decorators', link: '/guide/custom-decorators' },
      { text: 'HMR (Hot Reload)', link: '/guide/hmr' },
    ],
  },
  {
    text: 'CLI',
    items: [
      { text: 'Commands', link: '/guide/cli-commands' },
      { text: 'CLI Plugins', link: '/guide/cli-plugins' },
      { text: 'Tinker (REPL)', link: '/guide/tinker' },
      { text: 'Code Generators', link: '/guide/generators' },
      { text: 'Plugin Generators', link: '/guide/plugin-generators' },
      { text: 'Custom Commands', link: '/guide/custom-commands' },
    ],
  },
  {
    text: 'Database',
    items: [
      { text: 'Overview & Getting Started', link: '/guide/database/' },
      { text: 'Schema', link: '/guide/database/schema' },
      { text: 'Queries', link: '/guide/database/queries' },
      { text: 'Migrations', link: '/guide/database/migrations' },
      { text: 'CLI', link: '/guide/database/cli' },
      { text: 'Drivers', link: '/guide/database/drivers' },
      { text: 'Repositories', link: '/guide/database/repositories' },
    ],
  },
  {
    text: 'Database (kickjs-db)',
    items: [
      { text: 'Schema Types', link: '/guide/db-schema-types' },
      { text: 'Relational Queries', link: '/guide/db-relational-query' },
      { text: 'Extensions', link: '/guide/db-extensions' },
    ],
  },
  {
    text: 'Testing',
    items: [
      { text: 'Testing Guide', link: '/guide/testing' },
      { text: 'Benchmarks', link: '/guide/benchmarks' },
    ],
  },
  {
    text: 'Tutorials: Building a Jira Clone',
    collapsed: false,
    items: [
      { text: 'REST Module Architecture', link: '/guide/tutorial-ddd-architecture' },
      { text: 'Query Parsing & Pagination', link: '/guide/tutorial-query-pagination' },
      { text: 'Real-Time (SSE & WebSocket)', link: '/guide/tutorial-realtime' },
      { text: 'Background Jobs & Cron', link: '/guide/tutorial-background-jobs' },
    ],
  },
  {
    text: 'Tutorials: Framework Deep Dives',
    collapsed: true,
    items: [
      { text: 'DI Container Gotchas', link: '/guide/tutorial-di-gotchas' },
      { text: 'Surviving HMR with Decorators', link: '/guide/tutorial-hmr-decorators' },
      { text: 'JWT Auth & Refresh Rotation', link: '/guide/tutorial-jwt-auth' },
      { text: 'Custom CLI Commands', link: '/guide/tutorial-custom-cli' },
      { text: 'Module Generator Patterns', link: '/guide/tutorial-generator-patterns' },
      { text: 'Typed Client Vision', link: '/guide/tutorial-typed-client' },
    ],
  },
  {
    text: 'Project Direction',
    collapsed: false,
    items: [{ text: 'Roadmap & Proposals', link: '/guide/roadmap' }],
  },
]

const apiSidebar = [
  {
    text: 'Packages',
    items: [
      { text: '@forinda/kickjs', link: '/api/kickjs' },
      { text: '@forinda/kickjs-core', link: '/api/core' },
      { text: '@forinda/kickjs-http', link: '/api/http' },
      { text: '@forinda/kickjs-auth', link: '/api/auth' },
      { text: '@forinda/kickjs-swagger', link: '/api/swagger' },
      { text: '@forinda/kickjs-inertia', link: '/api/inertia' },
      { text: '@forinda/kickjs-db', link: '/api/db' },
      { text: '@forinda/kickjs-db-pg', link: '/api/db-pg' },
      { text: '@forinda/kickjs-db-sqlite', link: '/api/db-sqlite' },
      { text: '@forinda/kickjs-db-mysql', link: '/api/db-mysql' },
      { text: '@forinda/kickjs-ws', link: '/api/ws' },
      { text: '@forinda/kickjs-queue', link: '/api/queue' },
      { text: '@forinda/kickjs-devtools', link: '/api/devtools' },
      { text: '@forinda/kickjs-ai', link: '/api/ai' },
      { text: '@forinda/kickjs-mcp', link: '/api/mcp' },
      { text: '@forinda/kickjs-vite', link: '/api/vite' },
      { text: '@forinda/kickjs-cli', link: '/api/cli' },
      { text: '@forinda/kickjs-testing', link: '/api/testing' },
    ],
  },
]

// Examples live in their own repo (forinda/kickjs-examples-archive)
// since the workspace extraction. The single index page tells readers
// where to find the apps and how to run them.
const examplesSidebar = [
  {
    text: 'Examples',
    items: [{ text: 'Overview & archive', link: '/examples/' }],
  },
]

const schemasSidebar = [
  {
    text: 'Schema Abstraction',
    items: [
      { text: 'Overview & RFC', link: '/schemas/' },
      { text: 'Standard Schema v1', link: '/schemas/standard-schema' },
      { text: 'Adapters', link: '/schemas/adapters' },
      { text: 'Error Format', link: '/schemas/error-format' },
      { text: 'Framework Integration', link: '/schemas/integration' },
    ],
  },
]

const sharedSidebar = {
  '/guide/': guideSidebar,
  '/api/': apiSidebar,
  '/examples/': examplesSidebar,
  '/schemas/': schemasSidebar,
}

export default defineConfig(
  {
    title: 'KickJS',
    description:
      'A production-grade, decorator-driven Node.js framework built on Express 5 and TypeScript',
    base: '/kick-js/',
    ignoreDeadLinks: true,
    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/kick-js/logo.svg' }],
      ['meta', { name: 'theme-color', content: '#3b82f6' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'KickJS — The Adaptive Node.js Framework' }],
      [
        'meta',
        {
          property: 'og:description',
          content:
            'Decorator-driven APIs on Express 5. REST, WebSocket, queues, scheduled jobs — pick what you need.',
        },
      ],
      ['meta', { property: 'og:url', content: 'https://forinda.github.io/kick-js/' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ],

    themeConfig: {
      nav: [
        { text: 'Guide', link: '/guide/getting-started' },
        { text: 'Database', link: '/guide/database/' },
        { text: 'API', link: '/api/core' },
        { text: 'Schemas', link: '/schemas/' },
      ],

      logo: '/logo.svg',
      siteTitle: 'KickJS',

      sidebar: sharedSidebar,

      socialLinks: [
        { icon: 'github', link: 'https://github.com/forinda/kick-js' },
        { icon: 'npm', link: 'https://www.npmjs.com/package/@forinda/kickjs' },
      ],

      editLink: {
        pattern: 'https://github.com/forinda/kick-js/edit/main/docs/:path',
        text: 'Suggest changes to this page',
      },

      footer: {
        message:
          'Released under the <a href="https://github.com/forinda/kick-js/blob/main/LICENSE">MIT License</a>. Built with TypeScript + Express 5.',
        copyright: `Copyright &copy; ${new Date().getFullYear()} <a href="https://github.com/forinda">Felix Orinda</a>`,
      },

      search: {
        provider: 'local',
        options: {
          detailedView: true,
          miniSearch: {
            searchOptions: {},
          },
        },
      },
    },
  },
)
