import defineVersionedConfig from 'vitepress-versioning-plugin'
import pkg from '../../package.json'

const guideSidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is KickJS?', link: '/guide/what-is-kickjs' },
      { text: 'Inspiration', link: '/guide/inspiration' },
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Migration from Express', link: '/guide/migration-from-express' },
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
      { text: 'Validation', link: '/guide/validation' },
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
      { text: 'Reactivity', link: '/guide/reactivity' },
      { text: 'DevTools', link: '/guide/devtools' },
      { text: 'Adapters', link: '/guide/adapters' },
      { text: 'Authentication', link: '/guide/authentication' },
      { text: 'Authorization', link: '/guide/authorization' },
      { text: 'Multi-Tenancy', link: '/guide/multi-tenancy' },
      { text: 'Cron Jobs', link: '/guide/cron' },
      { text: 'Mailer', link: '/guide/mailer' },
      { text: 'AI', link: '/guide/ai' },
      { text: 'MCP (Model Context Protocol)', link: '/guide/mcp' },
      { text: 'Caching', link: '/guide/caching' },
      { text: 'View Engines', link: '/guide/view-engines' },
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
      { text: 'Tinker (REPL)', link: '/guide/tinker' },
      { text: 'Code Generators', link: '/guide/generators' },
      { text: 'Custom Commands', link: '/guide/custom-commands' },
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
      { text: 'Mongoose to Drizzle', link: '/guide/tutorial-mongoose-to-drizzle' },
      { text: 'DDD Module Architecture', link: '/guide/tutorial-ddd-architecture' },
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
]

const apiSidebar = [
  {
    text: 'Packages',
    items: [
      { text: '@forinda/kickjs-core', link: '/api/core' },
      { text: '@forinda/kickjs-http', link: '/api/http' },
      { text: '@forinda/kickjs-swagger', link: '/api/swagger' },
      { text: '@forinda/kickjs-cli', link: '/api/cli' },
      { text: '@forinda/kickjs-testing', link: '/api/testing' },
      { text: '@forinda/kickjs-prisma', link: '/api/prisma' },
      { text: '@forinda/kickjs-ws', link: '/api/ws' },
      { text: '@forinda/kickjs-drizzle', link: '/api/drizzle' },
      { text: '@forinda/kickjs-otel', link: '/api/otel' },
      { text: '@forinda/kickjs-graphql', link: '/api/graphql' },
      { text: '@forinda/kickjs-auth', link: '/api/auth' },
      { text: '@forinda/kickjs-cron', link: '/api/cron' },
      { text: '@forinda/kickjs-mailer', link: '/api/mailer' },
      { text: '@forinda/kickjs-queue', link: '/api/queue' },
      { text: '@forinda/kickjs-multi-tenant', link: '/api/multi-tenant' },
    ],
  },
]

const examplesSidebar = [
  {
    text: 'Full Applications',
    items: [
      { text: 'Overview', link: '/examples/' },
      { text: 'Jira Clone (Drizzle)', link: '/examples/jira-drizzle-api' },
      { text: 'Jira Clone (Prisma)', link: '/examples/jira-prisma-api' },
      { text: 'Jira Clone (Mongoose)', link: '/examples/jira-mongoose-api' },
    ],
  },
  {
    text: 'Multi-Tenant',
    items: [
      { text: 'Multi-Tenant (Drizzle)', link: '/examples/multi-tenant-drizzle-api' },
      { text: 'Multi-Tenant (Prisma)', link: '/examples/multi-tenant-prisma-api' },
      { text: 'Multi-Tenant (Mongoose)', link: '/examples/multi-tenant-mongoose-api' },
    ],
  },
  {
    text: 'Focused Examples',
    items: [
      { text: 'v2 Showcase', link: '/examples/v2-showcase-api' },
      { text: 'Minimal', link: '/examples/minimal-api' },
      { text: 'Joi Validation', link: '/examples/joi-api' },
      { text: 'DevTools', link: '/examples/devtools-api' },
      { text: 'GraphQL', link: '/examples/graphql-api' },
      { text: 'Microservice', link: '/examples/microservice-api' },
      { text: 'OpenTelemetry', link: '/examples/otel-api' },
    ],
  },
]

const sharedSidebar = {
  '/guide/': guideSidebar,
  '/api/': apiSidebar,
  '/examples/': examplesSidebar,
}

export default defineVersionedConfig(
  {
    versioning: {
      latestVersion: pkg.version,
    },
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
            'Decorator-driven APIs on Express 5. REST, GraphQL, WebSocket, queues — pick what you need.',
        },
      ],
      ['meta', { property: 'og:url', content: 'https://forinda.github.io/kick-js/' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ],

    themeConfig: {
      versionSwitcher: false,
      nav: [
        { text: 'Guide', link: '/guide/getting-started' },
        { text: 'API', link: '/api/core' },
        { text: 'Examples', link: '/examples/' },
        { component: 'VersionSwitcher' },
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
  __dirname,
)
