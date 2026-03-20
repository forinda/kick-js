import defineVersionedConfig from 'vitepress-versioning-plugin'
import pkg from '../../package.json'

const guideSidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is KickJS?', link: '/guide/what-is-kickjs' },
      { text: 'Getting Started', link: '/guide/getting-started' },
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
      { text: 'Middleware', link: '/guide/middleware' },
      { text: 'Validation', link: '/guide/validation' },
      { text: 'Error Handling', link: '/guide/error-handling' },
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
      { text: 'Server-Sent Events', link: '/guide/sse' },
      { text: 'Reactivity', link: '/guide/reactivity' },
      { text: 'DevTools', link: '/guide/devtools' },
      { text: 'Adapters', link: '/guide/adapters' },
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
      { text: 'Code Generators', link: '/guide/generators' },
      { text: 'Custom Commands', link: '/guide/custom-commands' },
    ],
  },
  {
    text: 'Testing',
    items: [{ text: 'Testing Guide', link: '/guide/testing' }],
  },
]

const apiSidebar = [
  {
    text: 'Packages',
    items: [
      { text: '@forinda/kickjs-core', link: '/api/core' },
      { text: '@forinda/kickjs-http', link: '/api/http' },
      { text: '@forinda/kickjs-config', link: '/api/config' },
      { text: '@forinda/kickjs-swagger', link: '/api/swagger' },
      { text: '@forinda/kickjs-cli', link: '/api/cli' },
      { text: '@forinda/kickjs-testing', link: '/api/testing' },
      { text: '@forinda/kickjs-prisma', link: '/api/prisma' },
      { text: '@forinda/kickjs-ws', link: '/api/ws' },
      { text: '@forinda/kickjs-drizzle', link: '/api/drizzle' },
      { text: '@forinda/kickjs-otel', link: '/api/otel' },
    ],
  },
]

const examplesSidebar = [
  {
    text: 'Examples',
    items: [
      { text: 'Overview', link: '/examples/' },
      { text: 'Basic API', link: '/examples/basic-api' },
      { text: 'Auth API', link: '/examples/auth-api' },
      { text: 'Validated API', link: '/examples/validated-api' },
      { text: 'Full API', link: '/examples/full-api' },
      { text: 'DevTools API', link: '/examples/devtools-api' },
      { text: 'WebSocket Chat', link: '/examples/ws-api' },
      { text: 'Drizzle ORM', link: '/examples/drizzle-api' },
      { text: 'SSE Streaming', link: '/examples/sse-api' },
      { text: 'OpenTelemetry', link: '/examples/otel-api' },
    ],
  },
]

const sharedSidebar = {
  '/guide/': guideSidebar,
  '/api/': apiSidebar,
  '/examples/': examplesSidebar,
}

function localeSidebar(code: string) {
  return {
    [`/${code}/guide/`]: guideSidebar,
    [`/${code}/api/`]: apiSidebar,
    [`/${code}/examples/`]: examplesSidebar,
  }
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
    head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],

    locales: {
      root: {
        label: 'English',
        lang: 'en',
      },
      fr: {
        label: 'Français',
        lang: 'fr-FR',
        link: '/fr/',
        themeConfig: { sidebar: localeSidebar('fr') },
      },
      es: {
        label: 'Español',
        lang: 'es-ES',
        link: '/es/',
        themeConfig: { sidebar: localeSidebar('es') },
      },
      de: {
        label: 'Deutsch',
        lang: 'de-DE',
        link: '/de/',
        themeConfig: { sidebar: localeSidebar('de') },
      },
      zh: {
        label: '中文',
        lang: 'zh-CN',
        link: '/zh/',
        themeConfig: { sidebar: localeSidebar('zh') },
      },
      ja: {
        label: '日本語',
        lang: 'ja-JP',
        link: '/ja/',
        themeConfig: { sidebar: localeSidebar('ja') },
      },
      pt: {
        label: 'Português',
        lang: 'pt-BR',
        link: '/pt/',
        themeConfig: { sidebar: localeSidebar('pt') },
      },
      ar: {
        label: 'العربية',
        lang: 'ar-SA',
        link: '/ar/',
        themeConfig: { sidebar: localeSidebar('ar') },
      },
    },

    themeConfig: {
      versionSwitcher: false,
      nav: [
        { text: 'Guide', link: '/guide/getting-started' },
        { text: 'API', link: '/api/core' },
        { text: 'Examples', link: '/examples/' },
        {
          text: `v${pkg.version}`,
          items: [
            { text: 'Changelog', link: '/changelog' },
            { text: 'Roadmap', link: '/roadmap' },
          ],
        },
        { component: 'VersionSwitcher' },
      ],

      sidebar: sharedSidebar,

      socialLinks: [{ icon: 'github', link: 'https://github.com/forinda/kick-js' }],

      editLink: {
        pattern: 'https://github.com/forinda/kick-js/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },

      footer: {
        message: 'Released under the MIT License.',
        copyright: `Copyright ${new Date().getFullYear()} Felix Orinda`,
      },

      search: {
        provider: 'local',
      },
    },
  },
  __dirname,
)
