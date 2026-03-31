import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',
  modules: {
    dir: 'src/modules',
    repo: 'inmemory',
    pluralize: true,
  },
})
