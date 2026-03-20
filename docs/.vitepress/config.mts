import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'KickJS',
  description: 'A production-grade, decorator-driven Node.js framework built on Express 5 and TypeScript',
  base: '/kick-js/',
  ignoreDeadLinks: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/core' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'v0.3.0-alpha',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
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
            { text: 'Swagger / OpenAPI', link: '/guide/swagger' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Adapters', link: '/guide/adapters' },
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
          items: [
            { text: 'Testing Guide', link: '/guide/testing' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'Packages',
          items: [
            { text: '@forinda/kickjs-core', link: '/api/core' },
            { text: '@forinda/kickjs-http', link: '/api/http' },
            { text: '@forinda/kickjs-config', link: '/api/config' },
            { text: '@forinda/kickjs-swagger', link: '/api/swagger' },
            { text: '@forinda/kickjs-cli', link: '/api/cli' },
            { text: '@forinda/kickjs-testing', link: '/api/testing' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Basic API', link: '/examples/basic-api' },
            { text: 'Auth API', link: '/examples/auth-api' },
            { text: 'Validated API', link: '/examples/validated-api' },
            { text: 'Full API', link: '/examples/full-api' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/forinda/kick-js' },
    ],

    editLink: {
      pattern: 'https://github.com/forinda/kick-js/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024-present Felix Orinda',
    },

    search: {
      provider: 'local',
    },
  },
})
